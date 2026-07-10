-- 055_seo_valves.sql
-- Valves for the SEO/AEO growth loops. All ship OFF; enablement is a
-- deliberate owner step from /admin/homepage-team.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 055
--
-- keyword_research_enabled: gates the monthly /cron/keyword-research run
--   (paused in #198 to stop spend; LLM-only expansion when DataForSEO creds
--   are absent).
-- seo_curation_enabled: kill switch for the weekly seo-curator routine
--   (gray-zone keyword triage, cluster hygiene, content-brief planning).
-- reviews_pdp_enabled: flips the PDP review block and aggregateRating JSON-LD
--   together. Flip only once at least one real approved customer review
--   exists; never decouple the two (Google review-snippet policy).

INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('keyword_research_enabled', 'false', NOW()),
  ('seo_curation_enabled',     'false', NOW()),
  ('reviews_pdp_enabled',      'false', NOW())
ON CONFLICT (key) DO NOTHING;
