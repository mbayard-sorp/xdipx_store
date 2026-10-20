-- 130: Ads Control Plane, phase 4a (ticket #16427). ADR-018 and
-- docs/store-team/ads-control-plane-plan.md sections 3.3, 5 and 9.4.
-- ad_actions is the mutation ledger: one row per change the control plane
-- wants to make on an ad platform, whoever proposed it. ad_rule_events stays
-- the record of rule evaluations; this table is the record of mutations, and
-- a rule event that wants a platform change creates exactly one row here.
-- idempotency_key is built by app/lib/ads/ledger-core.ts from platform,
-- target, verb, day and a params hash, so a rule that fires twice on the
-- same day for the same change writes one row, not two.
--
-- Allowed values (enforced in app/lib/ads/ledger-core.ts, not by CHECK, so
-- a later phase can add a value without a non-additive constraint change):
--   target_level: campaign | adset | ad | creative
--   verb:         pause | resume | set_budget | update_creative | halt_all
--   proposed_by:  rule:<id> (rule:R5), agent:<name> (agent:paid-media-buyer), owner
--   tier:         auto | approve | owner
--   status:       proposed | dry_run | approved | applied | failed | rejected | expired
-- Legal status moves: proposed to approved, rejected or expired; approved to
-- applied, failed or expired. dry_run, applied, failed, rejected and expired
-- are terminal.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- only. No DROP, no RENAME, no ALTER, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 130
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ad_actions (
  id bigserial PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  platform text NOT NULL,
  target_level text NOT NULL,
  target_external_id text NOT NULL,
  verb text NOT NULL,
  params jsonb,
  before jsonb,
  after jsonb,
  proposed_by text NOT NULL,
  reason text,
  rule_event_id integer REFERENCES ad_rule_events(id) ON DELETE SET NULL,
  tier text NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  approved_by text,
  approved_at timestamptz,
  applied_at timestamptz,
  platform_response jsonb,
  error text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ad_actions_status_created ON ad_actions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ad_actions_platform_target ON ad_actions(platform, target_external_id);
