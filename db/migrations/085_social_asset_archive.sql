-- 085_social_asset_archive.sql
-- Social asset library lifecycle, archive half only (ticket #5426, owner
-- direction 2026-08-25). The purge (irreversible delete) is deliberately
-- OUT of scope for this migration and this PR; it is ticket #5427, not to be
-- worked until its own architecture review. This migration only adds the
-- columns and index a reversible archive needs.
--
--   archived_at    timestamptz. Set when an owner (or the auto-archive rule)
--                  archives a row. NULL means "in the active library". The
--                  library grid and the Composer picker both default to
--                  `archived_at IS NULL` (app/lib/social-studio.server.ts).
--   archived_by    Who archived it: an owner session id or 'auto' for the
--                  age-based rule.
--   purged_at      timestamptz, NOT NULL DEFAULT NULL, WRITTEN BY NOTHING in
--                  this PR. It exists only so a future purge job (#5427) has
--                  somewhere to record "the binary is gone" without needing
--                  another migration. Provenance survives even after a purge
--                  because the row itself is never deleted (see below).
--   shopify_file_id  The Shopify Files GID returned by fileCreate and
--                  previously discarded (app/lib/shopify.server.ts
--                  uploadMoodImageToShopifyFiles). Populated going forward
--                  for newly generated assets so a future purge can delete
--                  the exact Shopify file instead of guessing by filename.
--                  Historic rows (328 as of 2026-08-25) stay NULL; nothing
--                  here backfills them.
--
-- NEVER DELETE A ROW FROM social_media_assets. The publish gate's provenance
-- check (`isLibraryMember`, app/lib/social-asset-library.server.ts:228) reads
-- by ROW EXISTENCE: deleting a row would fail provenance retroactively on a
-- post that already passed the gate. Archiving only ever sets archived_at;
-- there is no delete path in this migration or in the application code this
-- PR ships.
--
-- FULLY ADDITIVE: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- only. No DROP, no RENAME, no ALTER TYPE, no DML. Merges on the ordinary
-- release-engine lane once migration-dry-run is green.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 085
-- Idempotent: safe to re-run.

ALTER TABLE social_media_assets ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE social_media_assets ADD COLUMN IF NOT EXISTS archived_by varchar(60);
ALTER TABLE social_media_assets ADD COLUMN IF NOT EXISTS purged_at timestamptz;
ALTER TABLE social_media_assets ADD COLUMN IF NOT EXISTS shopify_file_id varchar(120);

CREATE INDEX IF NOT EXISTS idx_social_media_assets_archived_at
  ON social_media_assets (archived_at)
  WHERE archived_at IS NOT NULL;
