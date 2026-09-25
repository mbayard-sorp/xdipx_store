-- 100_social_asset_adjudications.sql
-- Owner-scoped media-asset adjudications (ticket #10503). The publish gate's
-- subjective findings (age-read, exposure-read) are an agent judgment
-- re-evaluated fresh on every post, so a false-positive the owner has
-- already ruled on for a specific asset keeps re-BLOCKing every future post
-- that reuses it (concrete case, 2026-09-20: the femmefunn campervan asset,
-- rows 155/156, both false-positived and re-blocked on rework).
--
-- One row per asset url: the specific findings the owner is clearing, the
-- owner's note, and who adjudicated it. OWNER-WRITE ONLY
-- (admin.socials.library.$assetId.tsx, requireAdmin) -- an agent or a
-- team-token route may read this table but never write or clear a row, or
-- the gate becomes self-clearing. The deterministic FACT checks
-- (runDeterministicPublishChecks: stock, media provenance, caption ceiling,
-- vocabulary) never consult this table and keep running unconditionally.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT
-- EXISTS only. No DROP, no RENAME, no ALTER TYPE, no DML. Merges on the
-- ordinary release-engine lane once migration-dry-run is green.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 100
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS social_asset_adjudications (
  id                   SERIAL PRIMARY KEY,
  asset_url            TEXT NOT NULL,
  overridden_findings  JSONB NOT NULL DEFAULT '[]'::jsonb,
  note                 TEXT,
  adjudicated_by       VARCHAR(60) NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_asset_adjudications_url ON social_asset_adjudications(asset_url);
