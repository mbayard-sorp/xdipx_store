ALTER TABLE "emma_pick_groups" ADD COLUMN IF NOT EXISTS "last_failure_reason" varchar(60);--> statement-breakpoint
ALTER TABLE "emma_pick_groups" ADD COLUMN IF NOT EXISTS "last_failure_at" timestamp;
