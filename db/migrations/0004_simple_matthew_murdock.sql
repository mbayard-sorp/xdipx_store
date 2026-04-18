CREATE TABLE "returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"shopify_return_id" varchar(60) NOT NULL,
	"shopify_order_id" varchar(60) NOT NULL,
	"customer_gid" varchar(60) NOT NULL,
	"status" varchar(20) DEFAULT 'requested' NOT NULL,
	"reason" varchar(40),
	"reason_note" text,
	"line_items" json NOT NULL,
	"shopify_reverse_delivery_id" varchar(60),
	"label_url" text,
	"label_cost_cents" integer,
	"label_cost_estimated_cents" integer,
	"tracking_number" varchar(60),
	"tracking_status" varchar(40),
	"refund_amount_cents" integer,
	"shopify_refund_id" varchar(60),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"label_purchased_at" timestamp,
	"received_at" timestamp,
	"refunded_at" timestamp,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "returns_shopify_return_uniq" ON "returns" USING btree ("shopify_return_id");--> statement-breakpoint
CREATE INDEX "returns_customer_idx" ON "returns" USING btree ("customer_gid","created_at");--> statement-breakpoint
CREATE INDEX "returns_order_idx" ON "returns" USING btree ("shopify_order_id");--> statement-breakpoint
CREATE INDEX "returns_status_idx" ON "returns" USING btree ("status");