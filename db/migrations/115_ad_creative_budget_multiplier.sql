-- 115: Ad Studio v2, PR-H. One column on ad_creatives: budget_multiplier, the
-- running product of owner and rule budget changes (Scale +20% multiplies by
-- 1.2, Brake -30% by 0.7). 1 means untouched. The platform budget itself is
-- only changed through the export registry behind the ads_spend_enabled valve
-- (PR-E); this column is the recorded intent, so the Live tab and the rules
-- can read what the budget should be.
--
-- FULLY ADDITIVE: one ADD COLUMN IF NOT EXISTS. No DROP, no RENAME, no
-- ALTER TYPE, no DML. Existing rows read as 1 through the default.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 115
-- Idempotent: safe to re-run.

ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS budget_multiplier numeric(6,3) NOT NULL DEFAULT 1;
