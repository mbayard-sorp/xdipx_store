-- 085_social_posts_alt_text_brief.sql
-- Alt text + image brief on social posts (owner direction 2026-08-22, ticket
-- #5042; salvaged additive slice of the blocked #4891 / PR #856).
--
-- social_posts had no alt_text column, so the Instagram publisher had nowhere
-- to put an accessibility description of the image and it was getting written
-- INTO the caption instead. image_brief and subject give regeneration/rework a
-- durable record of what the image is supposed to depict, instead of only ever
-- being reconstructible from the caption text.
--
-- NOTE: migration 084_social_studio_v2.sql adds alt_text only to the NEW
-- social_post_slides table, never to social_posts, so these three columns do
-- not collide with anything already shipped.
--
-- FULLY ADDITIVE: ADD COLUMN IF NOT EXISTS only. Merges on the ordinary
-- release-engine lane once the migration-dry-run check is green; the production
-- build applies exactly these statements unattended.
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 085
-- Idempotent: safe to re-run.
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS alt_text text;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS image_brief text;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS subject text;
