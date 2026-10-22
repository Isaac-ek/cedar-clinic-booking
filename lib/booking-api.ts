export interface ApiEnv { DB?: D1Database; API_KEY?: string }
type Booking = { id: string; slot_id: string; name: string; email: string; status: string; created_at: string };
type StoredResponse = { fingerprint: string; status: number; response: string; retry_after: number | null };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Idempotency-Key",
  "Access-Control-Expose-Headers": "Retry-After",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const columns = "id, slot_id, name, email, status, created_at";
const error = (message: string, status: number) => json({ error: message }, status);
function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", ...headers } });
}
const normalEmail = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function authenticated(request: Request, expected: string) {
  const given = request.headers.get("X-API-Key") || "";
  const [a, b] = await Promise.all([hash(given), hash(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
async function readJson(request: Request) {
  // Bound the stream itself, including chunked requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A JSON body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 256 * 1024) { await reader.cancel(); throw new Error("JSON body is too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("Body must be valid JSON"); }
}

async function reset(request: Request, db: D1Database) {
  let body;
  try { body = await readJson(request); } catch (e) { return error((e as Error).message, 400); }
  if (!record(body) || !Array.isArray(body.slots)) return error("slots must be an array", 400);
  const ids = new Set<string>();
  const slots: { id: string; provider: string; start: string; end: string; startMs: number }[] = [];
  for (const slot of body.slots) {
    if (!record(slot) || typeof slot.id !== "string" || !slot.id.trim() || ids.has(slot.id) ||
      typeof slot.provider !== "string" || !slot.provider.trim() ||
      typeof slot.start !== "string" || typeof slot.end !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(slot.start) ||
      !/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(slot.end) ||
      !Number.isFinite(Date.parse(slot.start)) || !Number.isFinite(Date.parse(slot.end)) ||
      Date.parse(slot.end) <= Date.parse(slot.start)) return error("Each slot needs a unique id, provider, and valid start/end timestamps", 400);
    ids.add(slot.id);
    slots.push({ id: slot.id, provider: slot.provider, start: slot.start, end: slot.end, startMs: Date.parse(slot.start) });
  }
  // json_each avoids one bound parameter per slot and makes replacement atomic.
  await db.batch([
    db.prepare("DELETE FROM booking_requests"), db.prepare("DELETE FROM booking_attempts"),
    db.prepare("DELETE FROM bookings"), db.prepare("DELETE FROM slots"),
    db.prepare(`INSERT INTO slots (id, provider, start, end, start_ms)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.provider'),
        json_extract(value, '$.start'), json_extract(value, '$.end'), json_extract(value, '$.startMs')
      FROM json_each(?)`).bind(JSON.stringify(slots)),
  ]);
  return json({ ok: true });
}

async function book(request: Request, db: D1Database) {
  let body: unknown, parseError: string | null = null;
  try { body = await readJson(request); } catch (e) { parseError = (e as Error).message; body = null; }
  const fields = record(body) ? body : {};
  const email = normalEmail(fields.email);
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  const slotId = typeof fields.slot_id === "string" ? fields.slot_id : "";
  const validation = parseError || (!slotId.trim() ? "slot_id is required" : !name ? "name is required" :
    name.length > 200 ? "name must be 200 characters or fewer" : !validEmail(email) ? "A valid email is required" : null);
  const key = request.headers.get("Idempotency-Key");
  if (key !== null && (!key.trim() || key.length > 256)) return error("Idempotency-Key must contain 1 to 256 characters", 400);
  const fingerprint = await hash(canonical(body));
  const id = crypto.randomUUID();
  const now = Date.now(), cutoff = now - 60_000;
  // D1 batch is an atomic, serializable transaction on the database primary.
  // Only the request that claims the unique idempotency key may count an
  // attempt or insert a booking. The partial unique index is a second guard.
  const own = "EXISTS (SELECT 1 FROM booking_requests WHERE id = ?)";
  const result = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO booking_requests (id, idempotency_key, fingerprint, status, response)
      VALUES (?, ?, ?, 0, '{}')`).bind(id, key, fingerprint),
    db.prepare("DELETE FROM booking_attempts WHERE email = ? AND attempted_at <= ?").bind(email, cutoff),
    db.prepare(`INSERT INTO booking_attempts (id, email, attempted_at)
      SELECT ?, ?, ? WHERE ? <> '' AND ${own}
      AND (SELECT COUNT(*) FROM booking_attempts WHERE email = ?) < 5`).bind(id, email, now, email, id, email),
    db.prepare(`UPDATE booking_requests SET
      status = CASE
        WHEN ? <> '' AND NOT EXISTS (SELECT 1 FROM booking_attempts WHERE id = ?) THEN 429
        WHEN ? IS NOT NULL THEN 400
        WHEN NOT EXISTS (SELECT 1 FROM slots WHERE id = ?) THEN 404
        WHEN (SELECT start_ms FROM slots WHERE id = ?) <= ? THEN 400
        WHEN EXISTS (SELECT 1 FROM bookings WHERE slot_id = ? AND status = 'confirmed') THEN 409
        ELSE 201 END,
      response = json_object('error', CASE
        WHEN ? <> '' AND NOT EXISTS (SELECT 1 FROM booking_attempts WHERE id = ?) THEN 'Too many booking attempts for this email'
        WHEN ? IS NOT NULL THEN ?
        WHEN NOT EXISTS (SELECT 1 FROM slots WHERE id = ?) THEN 'slot not found'
        WHEN (SELECT start_ms FROM slots WHERE id = ?) <= ? THEN 'slot has already started'
        ELSE 'slot already booked' END),
      retry_after = CASE WHEN ? <> '' AND NOT EXISTS (SELECT 1 FROM booking_attempts WHERE id = ?)
        THEN MAX(1, CAST(((SELECT MIN(attempted_at) FROM booking_attempts WHERE email = ?) + 60000 - ? + 999) / 1000 AS INTEGER))
        ELSE NULL END
      WHERE id = ?`).bind(email, id, validation, slotId, slotId, now, slotId,
        email, id, validation, validation, slotId, slotId, now, email, id, email, now, id),
    db.prepare(`INSERT INTO bookings (id, slot_id, name, email, status, created_at)
      SELECT ?, ?, ?, ?, 'confirmed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM booking_requests WHERE id = ? AND status = 201`)
      .bind(id, slotId, name, email, id),
    db.prepare(`UPDATE booking_requests SET response = (
      SELECT json_object('id', id, 'slot_id', slot_id, 'name', name, 'email', email, 'status', status, 'created_at', created_at)
      FROM bookings WHERE id = ?) WHERE id = ? AND status = 201`).bind(id, id),
    db.prepare("SELECT fingerprint, status, response, retry_after FROM booking_requests WHERE id = ? OR idempotency_key = ?")
      .bind(id, key),
    // Non-idempotent responses need no durable cache; attempts remain durable.
    db.prepare("DELETE FROM booking_requests WHERE id = ? AND idempotency_key IS NULL").bind(id),
  ]);
  const saved = result[6].results[0] as unknown as StoredResponse;
  if (saved.fingerprint !== fingerprint) return error("Idempotency-Key was already used with a different body", 422);
  return json(JSON.parse(saved.response), saved.status, saved.retry_after ? { "Retry-After": String(saved.retry_after) } : {});
}

async function listBookings(url: URL, db: D1Database) {
  const email = normalEmail(url.searchParams.get("email"));
  if (!validEmail(email)) return error("A valid email query parameter is required", 400);
  const limitText = url.searchParams.get("limit") ?? "10";
  if (!/^\d+$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 50) return error("limit must be an integer from 1 to 50", 400);
  const limit = Number(limitText);
  const cursor = url.searchParams.get("cursor");
  let after = 0;
  if (cursor !== null) {
    try {
      const decoded = JSON.parse(atob(cursor));
      if (!record(decoded) || decoded.email !== email || !Number.isSafeInteger(decoded.sequence) || Number(decoded.sequence) < 1) throw new Error();
      after = Number(decoded.sequence);
    } catch { return error("Invalid cursor for this email", 400); }
  }
  const rows = await db.prepare(`SELECT sequence, ${columns} FROM bookings WHERE email = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`)
    .bind(email, after, limit + 1).all<Booking & { sequence: number }>();
  const page = rows.results.slice(0, limit);
  const nextCursor = rows.results.length > limit ? btoa(JSON.stringify({ email, sequence: page[page.length - 1].sequence })) : null;
  return json({ bookings: page.map(({ sequence: _sequence, ...booking }) => booking), next_cursor: nextCursor });
}

export async function handleApi(request: Request, env: ApiEnv): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!env.API_KEY || !env.DB) return error("Service is not configured", 503);
  if (!await authenticated(request, env.API_KEY)) return error("Missing or invalid API key", 401);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/$/, "") || "/";
  const db = env.DB; // No read replicas: all decisions and reads use the primary.
  try {
    if (path === "/reset" && request.method === "POST") return await reset(request, db);
    if (path === "/slots" && request.method === "GET") {
      const provider = url.searchParams.get("provider");
      const rows = await db.prepare(`SELECT s.id, s.provider, s.start, s.end,
        NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed') AS available
        FROM slots s ${provider !== null ? "WHERE s.provider = ?" : ""} ORDER BY s.start_ms ASC, s.id ASC`)
        .bind(...(provider !== null ? [provider] : [])).all();
      return json({ slots: rows.results.map(row => ({ ...row, available: Boolean(row.available) })) });
    }
    if (path === "/bookings" && request.method === "POST") return await book(request, db);
    if (path === "/bookings" && request.method === "GET") return await listBookings(url, db);
    const match = /^\/bookings\/([^/]+)$/.exec(path);
    if (match && ["GET", "DELETE"].includes(request.method)) {
      const id = decodeURIComponent(match[1]);
      if (request.method === "GET") {
        const booking = await db.prepare(`SELECT ${columns} FROM bookings WHERE id = ?`).bind(id).first();
        return booking ? json(booking) : error("booking not found", 404);
      }
      const results = await db.batch([
        db.prepare(`SELECT ${columns} FROM bookings WHERE id = ?`).bind(id),
        db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed' RETURNING ${columns}`).bind(id),
      ]);
      if (!results[0].results.length) return error("booking not found", 404);
      if (!results[1].results.length) return error("booking is already cancelled", 409);
      return json(results[1].results[0]);
    }
    if (["/reset", "/slots", "/bookings"].includes(path) || match) return error("Method not allowed", 405);
    return error("Endpoint not found", 404);
  } catch (e) {
    console.error("API request failed", e instanceof Error ? e.message : "unknown error");
    return error("An unexpected server error occurred", 500);
  }
}
