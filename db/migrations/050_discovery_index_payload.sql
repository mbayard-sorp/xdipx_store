-- 050_discovery_index_payload.sql
-- Durable backstop for the discovery product index (~3K SKUs). KV is the fast
-- path; this table survives KV eviction so getDiscoveryIndex() reads one
-- indexed row instead of returning [] on a cold instance (which renders an
-- empty storefront and gets edge-cached). Exactly one current row per
-- version, upserted on the unique index.

CREATE TABLE IF NOT EXISTS discovery_index_payload (
  id          SERIAL PRIMARY KEY,
  version     VARCHAR(16) NOT NULL,          -- INDEX_VERSION (discovery.server.ts)
  index_json  JSON        NOT NULL,          -- DiscoveryProduct[]
  vocab_json  JSON        NOT NULL,          -- DiscoveryVocab
  count       INTEGER     NOT NULL DEFAULT 0,
  built_at    TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS discovery_index_payload_version_uniq
  ON discovery_index_payload (version);
