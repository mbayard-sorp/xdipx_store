CREATE TABLE IF NOT EXISTS ivr_voices (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  voice_id   VARCHAR(100) NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ivr_voices_voice_id_uniq ON ivr_voices (voice_id);
CREATE INDEX IF NOT EXISTS ivr_voices_active_idx ON ivr_voices (active);
