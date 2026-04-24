CREATE TABLE IF NOT EXISTS "emma_pick_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"emma_context" text NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"source_value" text NOT NULL,
	"max_picks" integer DEFAULT 10 NOT NULL,
	"display_count" integer DEFAULT 4 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"brief_hash" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emma_pick_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"deal_handle" varchar(255) NOT NULL,
	"deal_date" date,
	"picks" json NOT NULL,
	"brief_hash" varchar(64) NOT NULL,
	"trigger" varchar(20) NOT NULL,
	"model" varchar(60),
	"input_tokens" integer,
	"output_tokens" integer,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "emma_pick_runs" ADD CONSTRAINT "emma_pick_runs_group_id_emma_pick_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."emma_pick_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "emma_pick_groups_slug_uniq" ON "emma_pick_groups" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "emma_pick_groups_active_idx" ON "emma_pick_groups" USING btree ("active","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "emma_pick_runs_group_deal_uniq" ON "emma_pick_runs" USING btree ("group_id","deal_handle");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "emma_pick_runs_deal_idx" ON "emma_pick_runs" USING btree ("deal_handle");
