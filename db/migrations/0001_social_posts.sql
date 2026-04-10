CREATE TABLE "pipeline_settings" (
	"key" varchar(50) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" varchar(20) NOT NULL,
	"post_type" varchar(20) NOT NULL,
	"external_post_id" varchar(50),
	"parent_post_id" integer,
	"deal_history_id" integer,
	"tweet_text" text NOT NULL,
	"media_urls" json,
	"media_ids" json,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"error_message" text,
	"posted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(20) DEFAULT 'system'
);
--> statement-breakpoint
ALTER TABLE "deal_history" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "deal_history" ADD COLUMN "vault_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "deal_history" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "deal_history" DROP COLUMN "archived_at";