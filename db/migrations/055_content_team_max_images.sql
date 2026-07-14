-- 055_content_team_max_images.sql
-- Wires an image cap for the content (daily Notebook) team.
--
-- Before this, the content team's max-images-per-day was hardcoded to 0 in
-- team.server.ts (getTeamConfig only read a max-images key for homepage), so the
-- gate always reported maxImagesPerDay:0 and the daily writer shipped every post
-- heroless. getTeamConfig now reads content_team_max_images for the content team;
-- this migration seeds it to 5 so the routine may generate hero/mood imagery.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 055
--
-- Advisory cap: the content routine self-limits to it (it makes ~1 hero a day).
-- Unlike homepage it is not hard-gated. Owner-editable in the Content tab of
-- /admin/homepage-team.

INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('content_team_max_images', '5', NOW())
ON CONFLICT (key) DO NOTHING;
