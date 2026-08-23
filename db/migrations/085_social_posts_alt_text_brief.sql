-- 085: alt text + image brief on social posts (owner direction 2026-08-22).
-- social_posts had no alt_text column, so the Instagram publisher had nowhere
-- to put an accessibility description of the image and it was getting written
-- INTO the caption instead. image_brief and subject give regeneration/rework
-- a durable record of what the image is supposed to depict, instead of only
-- ever being reconstructible from the caption text.
-- Renumbered from 084 to 085 (2026-08-23): main had already taken 084 for the
-- unrelated Social Studio v2 migration by the time this branch merged.
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 085
-- Idempotent: safe to re-run.
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS alt_text text;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS image_brief text;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS subject text;
