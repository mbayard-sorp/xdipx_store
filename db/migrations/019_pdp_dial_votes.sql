CREATE TABLE IF NOT EXISTS pdp_dial_votes (
  id                 SERIAL PRIMARY KEY,
  shopify_product_id VARCHAR(64) NOT NULL,
  dimension          VARCHAR(40) NOT NULL,
  customer_gid       VARCHAR(60) NOT NULL,
  vote               INTEGER NOT NULL,
  created_at         TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS pdp_dial_votes_uniq ON pdp_dial_votes (shopify_product_id, dimension, customer_gid);
CREATE INDEX IF NOT EXISTS pdp_dial_votes_product_idx ON pdp_dial_votes (shopify_product_id);
