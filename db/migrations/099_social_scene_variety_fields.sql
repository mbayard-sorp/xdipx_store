-- 099_social_scene_variety_fields.sql
-- Scene variety fields, part 2 (ticket #10269). Migration 093 added
-- scene_location, but no caller ever sent it (the API accepted it, no
-- document told social-art-director/social-media-manager to send it), so it
-- sat null on all 152 rows and the §3.8 location-variety window could only be
-- guessed from caption prose. This adds the three sibling columns the on-skin
-- campaign (#10267)'s variety windows need to be checkable the same way,
-- rather than repeating the same unpersisted-field mistake:
--
--   body_zone     varchar(40).  hip-hollow | sternum | small-of-back | nape |
--                                inner-wrist | forearm | stomach | thigh-top |
--                                behind-knee | shoulder-blade | ankle
--   contact_mode  varchar(20).  resting | self-held | other-held | drawn |
--                                worn | balanced
--   crop_scale    varchar(10).  macro | close | medium | wide
--
-- All nullable, no backfill: only rows drafted after the API/docs change
-- (same ticket) carry a value, exactly like scene_location.
--
-- FULLY ADDITIVE: ADD COLUMN IF NOT EXISTS only. No DROP, no RENAME, no ALTER
-- TYPE, no DML. Merges on the ordinary release-engine lane once
-- migration-dry-run is green.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 099
-- Idempotent: safe to re-run.

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS body_zone varchar(40);
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS contact_mode varchar(20);
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS crop_scale varchar(10);
