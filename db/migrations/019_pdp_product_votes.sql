-- Product-level aggregate votes for the PDP sensation dial.
-- One vote per (product, customer); flipping updates the existing row.
-- The older pdp_dial_votes (per-dimension) table is intentionally left in
-- place for now — a later cleanup migration can drop it.
CREATE TABLE IF NOT EXISTS pdp_product_votes (
  id                  SERIAL PRIMARY KEY,
  shopify_product_id  VARCHAR(64) NOT NULL,
  customer_gid        VARCHAR(60) NOT NULL,
  vote                INTEGER NOT NULL,
  created_at          TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS pdp_product_votes_uniq
  ON pdp_product_votes (shopify_product_id, customer_gid);

CREATE INDEX IF NOT EXISTS pdp_product_votes_product_idx
  ON pdp_product_votes (shopify_product_id);
