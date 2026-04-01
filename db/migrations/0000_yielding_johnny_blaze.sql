CREATE TABLE "consent_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(64),
	"customer_id" varchar(30),
	"ip_hash" varchar(64),
	"consent_given" boolean NOT NULL,
	"consent_type" varchar(20),
	"policy_version" varchar(10) NOT NULL,
	"consented_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_profit_summary" (
	"summary_date" date PRIMARY KEY NOT NULL,
	"total_orders" integer,
	"total_revenue" numeric(10, 2),
	"total_cogs" numeric(10, 2),
	"total_profit" numeric(10, 2),
	"avg_order_value" numeric(10, 2),
	"featured_sku" varchar(20),
	"ad_spend" numeric(10, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku" varchar(20) NOT NULL,
	"seo_title" text,
	"brand" varchar(100),
	"categories" json,
	"deal_date" date NOT NULL,
	"wholesale_cost" numeric(10, 2),
	"deal_price" numeric(10, 2),
	"msrp" numeric(10, 2),
	"map_price" numeric(10, 2),
	"units_available" integer,
	"units_sold" integer DEFAULT 0 NOT NULL,
	"total_revenue" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_profit" numeric(10, 2) DEFAULT '0' NOT NULL,
	"deal_score" numeric(5, 3),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"shopify_product_id" varchar(30),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"activated_at" timestamp,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref_code" varchar(50) NOT NULL,
	"referrer_type" varchar(20) DEFAULT 'affiliate',
	"referrer_id" varchar(50),
	"referred_customer_id" varchar(30),
	"first_order_id" varchar(30),
	"first_order_value" numeric(10, 2),
	"commission_pct" numeric(5, 2) DEFAULT '10.0',
	"commission_owed" numeric(10, 2),
	"commission_paid" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tos_acceptance" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" varchar(30) NOT NULL,
	"email" varchar(255),
	"tos_version" varchar(10) NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL,
	"ip_hash" varchar(64),
	"acceptance_method" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "tos_versions" (
	"version" varchar(10) PRIMARY KEY NOT NULL,
	"published_at" timestamp NOT NULL,
	"summary_of_changes" text,
	"full_text_url" text
);
