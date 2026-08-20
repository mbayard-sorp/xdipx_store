-- 081: ledger table for auto-applied additive migrations (incident: migration
-- 080 merged to main and sat unapplied for ~20 hours, 500ing the social lane
-- store-wide. This is the second merged-but-unapplied migration incident in
-- two days). scripts/apply-additive-migrations.ts reads this table to decide
-- which files in db/migrations/ it has already run, so a production build can
-- safely apply new additive-only migrations without re-running old ones.
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 081
-- Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS schema_migrations_applied (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
