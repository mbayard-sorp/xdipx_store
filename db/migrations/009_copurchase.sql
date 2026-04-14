-- Co-purchase data pipeline: raw line items + denormalized pair rollup.
-- Fed by server/webhooks.ts on Shopify orders/create.

CREATE TABLE IF NOT EXISTS order_line_items (
  id                 SERIAL PRIMARY KEY,
  shopify_order_id   VARCHAR(30) NOT NULL,
  shopify_product_id VARCHAR(30) NOT NULL,
  handle             VARCHAR(255),
  sku                VARCHAR(50),
  quantity           INTEGER NOT NULL,
  unit_price         DECIMAL(10, 2),
  created_at         TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS oli_order_idx  ON order_line_items (shopify_order_id);
CREATE INDEX IF NOT EXISTS oli_handle_idx ON order_line_items (handle);

-- Pairs stored with handle_a < handle_b lexicographically to avoid duplicates.
CREATE TABLE IF NOT EXISTS product_copurchase (
  id           SERIAL PRIMARY KEY,
  handle_a     VARCHAR(255) NOT NULL,
  handle_b     VARCHAR(255) NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS copurchase_pair_uniq ON product_copurchase (handle_a, handle_b);
CREATE INDEX IF NOT EXISTS copurchase_a_idx ON product_copurchase (handle_a);
CREATE INDEX IF NOT EXISTS copurchase_b_idx ON product_copurchase (handle_b);
