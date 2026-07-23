-- Synthetic checkout probe results. One row per probe run (HTTP tier every 6h,
-- browser tier daily). Lets the owner see funnel health over time and drives the
-- failure alert. Idempotent.
CREATE TABLE IF NOT EXISTS checkout_probe_runs (
  id           bigserial   PRIMARY KEY,
  ran_at       timestamptz NOT NULL DEFAULT now(),
  tier         text        NOT NULL,             -- 'http' | 'browser'
  ok           boolean     NOT NULL,
  failed_step  text,                             -- null when ok
  steps        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  duration_ms  integer,
  alerted      boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS checkout_probe_runs_ran_idx ON checkout_probe_runs (ran_at DESC);
