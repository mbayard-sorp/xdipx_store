-- 058_social_review.sql
-- Internal review period for the social team: layers an editorial review
-- lifecycle (review_status + owner feedback) on top of social_posts without
-- touching the publication lifecycle (status draft|posted|failed|deleted).
-- The owner reviews every agent draft in /admin/socials (Social Studio);
-- feedback flows back to social-media-manager verbatim via the team API and
-- trains the team before the channels go live. Nothing here opens a live
-- posting path — that stays behind social_team_autopost + X_AUTO_POST_ENABLED.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 058
--
-- social_freq_* are posts/day per platform (0 = platform off). Defaults: 1
-- per platform per day, facebook off.

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS review_status varchar(20) NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS feedback text,
  ADD COLUMN IF NOT EXISTS edited_text text,
  ADD COLUMN IF NOT EXISTS reviewed_by varchar(60),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp,
  ADD COLUMN IF NOT EXISTS scheduled_for date,
  ADD COLUMN IF NOT EXISTS reworked_from integer;

-- History rows (already posted or deleted) predate the review flow; keep them
-- out of the pending queue.
UPDATE social_posts SET review_status = 'approved'
WHERE status IN ('posted', 'deleted') AND review_status = 'pending_review';

INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('social_freq_x',         '1', NOW()),
  ('social_freq_instagram', '1', NOW()),
  ('social_freq_tiktok',    '1', NOW()),
  ('social_freq_facebook',  '0', NOW())
ON CONFLICT (key) DO NOTHING;
