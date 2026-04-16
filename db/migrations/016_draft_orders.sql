CREATE TABLE IF NOT EXISTS draft_orders (
  id                 SERIAL PRIMARY KEY,
  shopify_draft_id   VARCHAR(64) NOT NULL UNIQUE,
  shopify_invoice_url TEXT,
  channel            VARCHAR(10) NOT NULL,
  phone              VARCHAR(20) NOT NULL,
  email              VARCHAR(255),
  customer_name      VARCHAR(255),
  subtotal_cents     INTEGER NOT NULL,
  item_count         INTEGER NOT NULL,
  line_items         JSON NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'sent',
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS draft_orders_phone_idx   ON draft_orders (phone, created_at);
CREATE INDEX IF NOT EXISTS draft_orders_created_idx ON draft_orders (created_at);
