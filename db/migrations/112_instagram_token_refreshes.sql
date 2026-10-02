-- 112: Instagram Graph API access-token auto-refresh (ticket #13153,
-- owner-away all-hands 2026-10-02). IG_GRAPH_ACCESS_TOKEN is a 60-day token
-- that never refreshed itself and lapses silently (graph.facebook.com
-- debug_token rejects IG tokens, so expiry cannot be read from Meta
-- directly). Append-only: one row per refresh attempt, success or failure,
-- so a failed attempt never overwrites the last known-good token. Fully
-- additive.
CREATE TABLE IF NOT EXISTS instagram_token_refreshes (
  id serial PRIMARY KEY,
  access_token text,
  expires_at timestamptz,
  success boolean NOT NULL,
  error text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_instagram_token_refreshes_attempted ON instagram_token_refreshes(attempted_at);
