-- 061_nalpac_price_history.sql
-- WS3a: Nalpac price-history store for the price-drop / cost-sync loop (ADR-007:
-- docs/adr/ADR-007-pricing-engine-convergence.md).
--
-- One row per CARRIED sku, upserted with the LAST OBSERVED Nalpac feed snapshot
-- -- this is NOT an append-per-day history table. cost-sync.server.ts diffs
-- today's feed snapshot against this row to detect a material wholesale/MAP
-- drop. synced_at marks the last time we actually EMITTED a cost-sync (metafield
-- write + v2 recomputeVariant) for this sku, giving day-scoped idempotency
-- without a KV throttle.
--
-- Also seeds the dedicated pricing_costsync_enabled kill switch (default OFF).
-- Do NOT overload the pre-existing pricing_webhook_enabled switch (that one
-- gates the *v1* Nalpac cost-change webhook) -- see ADR-007 decision 1.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 061

CREATE TABLE IF NOT EXISTS nalpac_price_history (
  sku                 varchar(64) PRIMARY KEY,
  wholesale           numeric(10,2),
  msrp                numeric(10,2),
  map_price           numeric(10,2),
  sale_price          numeric(10,2),
  qty                 integer,
  nalpac_discount_pct numeric(5,2),
  in_top100           boolean NOT NULL DEFAULT false,
  in_new              boolean NOT NULL DEFAULT false,
  in_sale             boolean NOT NULL DEFAULT false,
  observed_at         timestamptz NOT NULL DEFAULT NOW(),
  synced_at           timestamptz
);

CREATE INDEX IF NOT EXISTS nalpac_price_history_synced_idx ON nalpac_price_history (synced_at);

INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('pricing_costsync_enabled', 'false', NOW())
ON CONFLICT (key) DO NOTHING;
