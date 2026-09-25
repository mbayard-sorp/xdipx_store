-- 104: owner feedback on social library images (ticket #11551).
-- One live verdict per asset ('up' | 'down'), fixed reason chips, optional note.
-- OWNER WRITE ONLY (admin routes behind requireAdmin); the social team reads it
-- via POST /api/team/social-asset-feedback. Fully additive.
CREATE TABLE IF NOT EXISTS social_asset_feedback (
  id serial PRIMARY KEY,
  asset_id integer NOT NULL,
  verdict varchar(8) NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]',
  note text,
  rated_by varchar(60) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_asset_feedback_asset ON social_asset_feedback(asset_id);
