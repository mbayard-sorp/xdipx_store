CREATE TABLE IF NOT EXISTS product_enrichment_cache (
  id              SERIAL PRIMARY KEY,
  product_id      VARCHAR(64) NOT NULL,
  field_name      VARCHAR(64) NOT NULL,
  voice_hash      VARCHAR(32) NOT NULL,
  prompt_version  VARCHAR(16) NOT NULL,
  content         JSON NOT NULL,
  model           VARCHAR(32) NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  generated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS enrich_cache_key_uniq
  ON product_enrichment_cache (product_id, field_name, voice_hash, prompt_version);

CREATE INDEX IF NOT EXISTS enrich_cache_product_idx
  ON product_enrichment_cache (product_id);

CREATE INDEX IF NOT EXISTS enrich_cache_generated_idx
  ON product_enrichment_cache (generated_at);
