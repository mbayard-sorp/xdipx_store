CREATE TABLE IF NOT EXISTS color_swatch_cache (
  color_key   VARCHAR(80)  PRIMARY KEY,
  label       VARCHAR(120) NOT NULL,
  hex         VARCHAR(7),
  source      VARCHAR(16)  NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);
