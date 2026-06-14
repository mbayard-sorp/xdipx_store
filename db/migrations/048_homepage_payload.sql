-- 048_homepage_payload.sql
-- Durable backstop for the precomputed Variant A homepage payload.
-- KV is the fast path; this table survives KV eviction so a Googlebot crawl on
-- a cold instance reads one indexed row instead of fanning out to 5+ upstreams.
-- Exactly one current row per (variant, version), upserted on the unique index.

CREATE TABLE IF NOT EXISTS homepage_payload (
  id          SERIAL PRIMARY KEY,
  variant     VARCHAR(8)  NOT NULL,         -- 'a' (room for 'b'/'legacy')
  version     VARCHAR(16) NOT NULL,         -- HOMEPAGE_PAYLOAD_VERSION
  payload     JSON        NOT NULL,         -- HomepagePayloadA (JSON-safe)
  degraded    BOOLEAN     NOT NULL DEFAULT false,
  built_at    TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS homepage_payload_variant_version_uniq
  ON homepage_payload (variant, version);
