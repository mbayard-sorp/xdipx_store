-- 079: engagement metrics on social posts (ticket #3536; code half shipped in PR #679).
-- Per-row metrics for the platform the row belongs to, merged field-level the
-- same way video_jobs.metrics_json is (recordVideoMetrics precedent).
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS metrics_json jsonb;
