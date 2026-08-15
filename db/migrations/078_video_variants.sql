-- 078_video_variants.sql
-- Batch variant sets for the video pipeline (Arcads-parity build, spec:
-- docs/store-team/video-arcads-assessment-and-plan.md §5 Phase 1) plus the two
-- post-pass valves from Phases 1-2.
--
-- variant_group_id groups the N jobs expanded from one enqueue-set call;
-- variant_axes records which axis values (hook / presenter / scene) each
-- sibling got so Video Studio can label them.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 078
-- Idempotent: safe to re-run.

ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS variant_group_id varchar(36);
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS variant_axes jsonb;

CREATE INDEX IF NOT EXISTS idx_video_jobs_variant_group
  ON video_jobs (variant_group_id)
  WHERE variant_group_id IS NOT NULL;

-- video_team_max_variants_per_set: hard cap on jobs one enqueue-set call may
-- expand to. video_endcard_enabled: 1.5s logo+CTA outro appended in assembly,
-- OFF until the owner approves the design.
INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('video_team_max_variants_per_set', '4',     NOW()),
  ('video_endcard_enabled',           'false', NOW())
ON CONFLICT (key) DO NOTHING;
