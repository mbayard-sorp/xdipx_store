-- 109_social_media_assets_product_identity_block.sql
-- Ticket #11954. B-Swish Bthrilled wand assets 720/728/730 had visionVerdict.
-- pass=true (the frame judged fine in isolation) yet the publish gate BLOCKed
-- them on product-identity (foam/fabric massager head vs the real smooth
-- silicone wand) every time reuse-first offered them, burning gate attempts
-- on assets that can never ship.
--
-- product_identity_failed_at/last_gate_block let applyPublishGateVerdict
-- (app/lib/social-publish-approve.server.ts) record a product-identity BLOCK
-- back onto the reused asset row, so social-asset-query's reuse-first search
-- (app/lib/social-studio.server.ts) can stop offering it. Never cleared once
-- set: a fix means generating a correctly-identified asset, not rehabilitating
-- this row.
--
-- FULLY ADDITIVE: ADD COLUMN IF NOT EXISTS only. No DROP, no RENAME, no
-- ALTER TYPE, no DML. (Backfilling assets 720/728/730 themselves is a data
-- fix, not a schema change, and runs separately via
-- scripts/backfill-product-identity-block.ts — see that script's header.)
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 109
-- Idempotent: safe to re-run.

ALTER TABLE social_media_assets ADD COLUMN IF NOT EXISTS product_identity_failed_at timestamptz;
ALTER TABLE social_media_assets ADD COLUMN IF NOT EXISTS last_gate_block text;
