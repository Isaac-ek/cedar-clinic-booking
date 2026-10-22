CREATE TABLE `booking_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`attempted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attempts_email_time` ON `booking_attempts` (`email`,`attempted_at`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`slot_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`slot_id`) REFERENCES `slots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_id_unique` ON `bookings` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_confirmed_booking_per_slot` ON `bookings` (`slot_id`) WHERE "bookings"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX `bookings_email_sequence` ON `bookings` (`email`,`sequence`);--> statement-breakpoint
CREATE TABLE `booking_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text,
	`fingerprint` text NOT NULL,
	`status` integer NOT NULL,
	`response` text NOT NULL,
	`retry_after` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_requests_idempotency_key_unique` ON `booking_requests` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `slots` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`start_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `slots_start` ON `slots` (`start_ms`,`id`);