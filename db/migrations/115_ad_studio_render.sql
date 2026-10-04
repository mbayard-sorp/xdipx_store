-- 115: Ad Studio v2, PR-C (docs/store-team/ad-studio-v2-plan.md section 5, ad-render).
-- Render pipeline columns. gates_json holds the five gate verdicts
-- (vision, product, voice, policy, text) so the Creatives tab can show chips
-- without recomputing. render_json holds the render ledger for the row: state,
-- provider, cost, request id, skipped or failed reason. media_assets gains a
-- provenance column so a rendered creative and its plate carry idea id,
-- concept, prompt, provider request id and format with the bytes.
--
-- ad_creatives.status is varchar(16) with no CHECK, so no status DDL is
-- needed. Values used from this PR on: draft (queued, or rendered and awaiting
-- a rating), rendering (a render is in flight), blocked (a gate blocked it),
-- failed (the render errored). Pre-v2 values (approved, rejected, pushed) are
-- unchanged.
--
-- FULLY ADDITIVE: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS only.
-- No DROP, RENAME, ALTER TYPE or DML. Every existing row stays valid.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 115
-- Idempotent: safe to re-run.

ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS gates_json jsonb;
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS render_json jsonb;
CREATE INDEX IF NOT EXISTS idx_ad_creatives_status ON ad_creatives(status, created_at);

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS provenance jsonb;
