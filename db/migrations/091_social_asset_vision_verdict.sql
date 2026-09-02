-- 091_social_asset_vision_verdict.sql
-- Vision-gate hard check on generated social imagery (ticket #6763, incident:
-- social_posts #145, a three-armed cast member published to Instagram and
-- removed by the owner the same day). docs/design-doctrine.md:224 mandates a
-- "vision-gate hard check: hand anatomy" on every imagery surface; it existed
-- as agent doctrine only, never as code. This migration adds the columns the
-- new code-enforced check (app/lib/social-vision-gate.server.ts) writes its
-- verdict to.
--
--   vision_verdict     jsonb. { pass, checks: { limbCount, handAnatomy,
--                       faceBodyIntegrity, extraOrMergedLimbs }, notes,
--                       checkedAt }. NULL means "never checked", which the
--                       publish gate (app/lib/social-publish-gate.server.ts)
--                       now treats as a BLOCK for any library asset, not a
--                       silent skip.
--   vision_verdict_at  timestamptz, denormalised from the verdict payload for
--                       cheap "checked in the last N minutes" queries without
--                       parsing the jsonb.
--
-- FULLY ADDITIVE: ADD COLUMN IF NOT EXISTS only. No DROP, no RENAME, no ALTER
-- TYPE, no DML. Merges on the ordinary release-engine lane once
-- migration-dry-run is green.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 091
-- Idempotent: safe to re-run.

ALTER TABLE social_media_assets ADD COLUMN IF NOT EXISTS vision_verdict jsonb;
ALTER TABLE social_media_assets ADD COLUMN IF NOT EXISTS vision_verdict_at timestamptz;
