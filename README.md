# Cedar Clinic

A working clinic appointment API and responsive patient page implementing all five levels of the [Koya booking assessment](https://koyaacademy.com/assessment-api). The exact supplied OpenAPI document is in [openapi.json](openapi.json).

- Web page: https://cedar-clinic-booking.gudubakangizo.chatgpt.site
- API base: https://cedar-clinic-booking.gudubakangizo.chatgpt.site/api
- Public source: https://github.com/Isaac-ek/cedar-clinic-booking
- API key: supplied separately with the submission; never committed to this repository.

Open the page, click **Connect to clinic**, and enter the submission API key. Choose a date, clinician and available time, enter a name and email, and confirm. The page also supports lookup by email or reference, cursor pagination, and cancellation. Times are displayed in West Africa Time (UTC+1). This assessment demo does not send email.

## Stack and storage

TypeScript, React, Vinext, Cloudflare Workers, Cloudflare D1 (persistent SQLite), and Drizzle-generated schema migrations. The page and API share one origin. D1 is a hosted database: records do not depend on a Worker instance, browser storage, or a serverless filesystem. Session storage contains only the browser tab's API key.

## API contract

All API requests require `X-API-Key`. Missing/wrong keys return `401`. All error bodies are `{ "error": "message" }`. CORS preflight returns `204` and performs no action.

| Method | Path | Result |
|---|---|---|
| POST | `/reset` | Atomically deletes bookings, request history and rate limits; replaces slots, including past slots. `200`. |
| GET | `/slots` | All slots sorted by start, with boolean `available`; optional exact `provider` filter. |
| POST | `/bookings` | `{slot_id,name,email}` → booking, `201`. Optional `Idempotency-Key`. |
| GET | `/bookings/:id` | Booking, `200`; missing booking, `404`. |
| DELETE | `/bookings/:id` | Cancelled booking, `200`; already cancelled, `409`; missing, `404`. |
| GET | `/bookings?email=...&limit=10&cursor=...` | `{bookings,next_cursor}`; oldest first, email match ignores case. Limit: 1–50. |

Validation trims names and emails, lowercases emails, and rejects missing/empty/wrong-type fields, invalid email, unknown slots (`404`) and started slots (`400`). A conflicting confirmed booking returns `409`. Only confirmed bookings make a slot unavailable; cancellation releases it.

```sh
# Set these in your shell; do not put the actual key in source control.
export API_BASE_URL='https://cedar-clinic-booking.gudubakangizo.chatgpt.site/api'
export API_KEY='your-submission-key'
curl "$API_BASE_URL/slots" -H "X-API-Key: $API_KEY"
curl "$API_BASE_URL/bookings" \
  -H "X-API-Key: $API_KEY" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: appointment-001' \
  --data '{"slot_id":"replace-with-a-slot-id","name":"Ada Obi","email":"ada@example.com"}'
```

## Why concurrency is safe

The booking decision runs as one atomic D1 `batch()` transaction, on the database primary. It claims a unique idempotency key, accounts for the email's rate-limit attempt, checks slot state, inserts at most one booking, and stores the original response before committing. Concurrent transactions cannot interleave these decisions.

The database also has a **partial unique index on `bookings(slot_id) WHERE status = 'confirmed'`**. Even an application error cannot insert two confirmed bookings for one slot. Cancellation is an atomic conditional update; two concurrent cancellations yield one `200` and one `409`.

An idempotency key maps to a canonical JSON body fingerprint and the exact original status/body, including failures. Retries with reordered JSON object keys are treated as the same body. A different body returns `422`. A retry after cancellation still returns the original creation response; a fresh GET returns the current status. Successful replays do not count as new booking attempts. Keys persist until `/reset`; there is no in-memory cache or time-based eviction.

The limiter keeps up to five attempts per normalized email in a sliding 60-second window. Invalid bookings with a supplied email count. The sixth attempt returns `429` and a whole-second `Retry-After`, rounded up. Other emails remain independent. Admission and booking are in the same transaction, so simultaneous requests cannot bypass the limit. Expired attempts are removed when that email next makes a request. Denied attempts do not extend the cooldown.

Pagination uses the booking insertion sequence as a stable ordering key. Database-generated timestamps follow insertion order; sequence resolves ties. Cursors bind the last sequence to the normalized email and are validated. Cancelled bookings remain in the history. No offset pagination is used.

## Code map

- `lib/booking-api.ts`: API key authentication, validation, endpoint handlers, transaction, pagination.
- `db/schema.ts` and `drizzle/`: durable tables and database constraints.
- `app/api/[[...path]]/route.ts`: thin HTTP adapter under `/api`.
- `app/page.tsx` and `app/globals.css`: patient booking and management UI.
- `tests/contract.mjs`: the same five-level contract suite for local and deployed targets.
- `tests/api.test.mjs`: real Miniflare D1 tests plus cooldown and direct constraint checks.
- `scripts/check-contract.mjs`: HTTP contract checks, including concurrent requests.
- `scripts/seed-demo.mjs`: explicitly invoked sample slots, separate from migrations.

## Run locally

Node **24.5+** is recommended for built-in TypeScript stripping used by tests. Install with `npm ci`. Create an untracked `.dev.vars` file:

```dotenv
API_KEY=choose-a-local-key
```

The hosting manifest declares the D1 binding `DB`. Build once and apply the checked-in migration to the local database:

```sh
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js \
  d1 execute DB --local --config dist/server/wrangler.json \
  --persist-to .wrangler/state --file drizzle/0000_right_grey_gargoyle.sql
npm run dev -- --port 5177 --hostname 127.0.0.1
```

Seed only a disposable database, using the API key configured for that target:

```sh
API_BASE_URL=http://127.0.0.1:5177/api ALLOW_RESET=1 node scripts/seed-demo.mjs
```

`API_KEY` must also be set in the shell for the seed/check scripts. `.dev.vars` is loaded by the local server, not by these scripts.

## Verification

```sh
npm test
npm run typecheck
npm run build
API_BASE_URL=http://127.0.0.1:5177/api ALLOW_RESET=1 npm run test:contract
```

The tests cover each level in order: API key enforcement, malformed bodies, exact filtering, normalization, past slots, reset atomicity, a 40-request booking race, concurrent cancellation, 16 simultaneous retries sharing one key, conflicting bodies, stable multi-page history, failed-attempt throttling, independent emails, concurrent rate admission, cooldown expiry, and the database unique constraint itself. The test database is isolated and disposed after the run.

**The HTTP suite and seeder replace every slot and booking at their target.** They require `ALLOW_RESET=1`. Do not run them on the submitted deployment once assessment has started.

## Hosting and submission freeze

Sites provisions the D1 database and applies checked-in migrations before publishing the Worker. The production `API_KEY` is a runtime secret, not a build variable. API access is authenticated independently from the public page. There are no scheduled jobs, automatic reseeds or deployment triggers in this project.

After final verification and submission, leave the deployment and key unchanged until the assessors contact you. The required `/reset` endpoint remains available for the assessors' test harness. This is a contract-focused assessment demo with shared API-key authorization; a clinic handling real patient data would need individual patient authorization in addition to this assessment contract.
