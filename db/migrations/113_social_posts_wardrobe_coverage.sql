-- 113_social_posts_wardrobe_coverage.sql
-- Ticket #13163, owner all-hands 2026-10-02 ("I'd rather see a bra line than
-- a piece of fabric... stay away from the bulky fabric look"). Wardrobe
-- coverage was not measured, so a folded sheet or towel became the feed's
-- de facto uniform and nothing in the mix report went red: 15 of the last 20
-- on-skin frames used a sheet or towel, and worn garments in generated
-- prompts fell from 66/week to 0/week, both invisible until the owner said so
-- by hand. Sibling column to body_zone/contact_mode/crop_scale (migration
-- 099): report-only for now, not required at generation.
--
-- FULLY ADDITIVE: ADD COLUMN IF NOT EXISTS only. No DROP, no RENAME, no
-- ALTER TYPE, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 113
-- Idempotent: safe to re-run.

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS wardrobe_coverage varchar(20);
