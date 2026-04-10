-- Deal flow re-engineering: simplify statuses, add vault pricing, remove archiving
-- Status model: draft → scheduled → live (+ vault for completed deals in Shopify)

-- Add vault_price column
ALTER TABLE "deal_history" ADD COLUMN "vault_price" numeric(10, 2);

-- Add completed_at column
ALTER TABLE "deal_history" ADD COLUMN "completed_at" timestamp;

-- Migrate archived_at → completed_at
UPDATE "deal_history" SET "completed_at" = "archived_at" WHERE "archived_at" IS NOT NULL;

-- Migrate statuses: pending_review/pending → draft, approved → scheduled, archived → scheduled (with completed_at)
UPDATE "deal_history" SET "status" = 'draft' WHERE "status" IN ('pending_review', 'pending');
UPDATE "deal_history" SET "status" = 'scheduled' WHERE "status" IN ('approved', 'archived');

-- Change default
ALTER TABLE "deal_history" ALTER COLUMN "status" SET DEFAULT 'draft';

-- Drop archived_at column
ALTER TABLE "deal_history" DROP COLUMN "archived_at";
