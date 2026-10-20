-- 133: Ads Control Plane, phase 6c (ticket #16436). ADR-018 and
-- docs/store-team/ads-control-plane-plan.md sections 3.3, 9.2 and 9.5.
-- ad_experiments is the hypothesis log for creative and audience tests. One
-- row per experiment. arms is a jsonb array of {label, platform, level,
-- externalId}, each pointing at an ad_platform_entities row. At this spend
-- an experiment is a structured log, not a stats engine (plan section 8):
-- the console shows each arm against the section 9.2 floors and the owner
-- writes the verdict. Nothing decides automatically.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- only. No DROP, no RENAME, no ALTER, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 133
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ad_experiments (
  id bigserial PRIMARY KEY,
  hypothesis text NOT NULL,
  variable text NOT NULL CHECK (variable IN ('hook', 'format', 'product', 'audience', 'placement')),
  arms jsonb NOT NULL,
  primary_metric text NOT NULL CHECK (primary_metric IN ('cpl', 'cpa', 'roas')),
  min_spend_cents integer NOT NULL DEFAULT 4000,
  starts_at timestamptz,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'running', 'decided', 'abandoned')),
  verdict text,
  decided_by text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ad_experiments_status ON ad_experiments(status);
