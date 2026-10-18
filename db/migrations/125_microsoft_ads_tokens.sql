-- 125: Microsoft Advertising OAuth refresh-token store.
--
-- Microsoft's identity platform may hand back a NEW refresh token on every
-- refresh and expects the caller to keep it, so the one-time env-var pattern
-- the Reddit connect flow uses (mint once, paste into Vercel) goes stale on
-- the first refresh. This table holds the current refresh token instead.
--
-- Append-only, one row per connect or refresh attempt, success or failure,
-- so a failed refresh never overwrites the last known-good token (same shape
-- as instagram_token_refreshes, migration 112). The token is stored AES-256-GCM
-- encrypted with MSADS_TOKEN_KEY, never in plaintext. `env` keeps sandbox and
-- production tokens apart, because they belong to different Microsoft
-- accounts. See app/lib/microsoft-ads-token.server.ts.
--
-- FULLY ADDITIVE: one CREATE TABLE IF NOT EXISTS and one CREATE INDEX IF NOT
-- EXISTS. No DROP, no RENAME, no ALTER TYPE, no DML.

CREATE TABLE IF NOT EXISTS microsoft_ads_tokens (
  id serial PRIMARY KEY,
  env varchar(16) NOT NULL,
  refresh_token_enc text,
  scope text,
  source varchar(16) NOT NULL,
  success boolean NOT NULL,
  error text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_microsoft_ads_tokens_env_attempted ON microsoft_ads_tokens(env, attempted_at);
