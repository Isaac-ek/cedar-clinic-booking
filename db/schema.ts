import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const slots = sqliteTable("slots", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  start: text("start").notNull(),
  end: text("end").notNull(),
  startMs: integer("start_ms").notNull(),
}, (t) => [index("slots_start").on(t.startMs, t.id)]);

export const bookings = sqliteTable("bookings", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  id: text("id").notNull().unique(),
  slotId: text("slot_id").notNull().references(() => slots.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  status: text("status", { enum: ["confirmed", "cancelled"] }).notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [
  uniqueIndex("one_confirmed_booking_per_slot").on(t.slotId).where(sql`${t.status} = 'confirmed'`),
  index("bookings_email_sequence").on(t.email, t.sequence),
]);

// Every booking decision runs in one D1 transaction. This row records the
// immutable original response for an idempotency key, including error responses.
export const requests = sqliteTable("booking_requests", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").unique(),
  fingerprint: text("fingerprint").notNull(),
  status: integer("status").notNull(),
  response: text("response").notNull(),
  retryAfter: integer("retry_after"),
});

export const attempts = sqliteTable("booking_attempts", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  attemptedAt: integer("attempted_at").notNull(),
}, (t) => [index("attempts_email_time").on(t.email, t.attemptedAt)]);
