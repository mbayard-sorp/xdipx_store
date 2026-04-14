-- Wishlists feature: customer-scoped lists + items.
-- Customers can have multiple named lists; each list is private by default and
-- becomes shareable when a public_slug is assigned.

CREATE TABLE IF NOT EXISTS wishlists (
  id            SERIAL PRIMARY KEY,
  customer_gid  VARCHAR(60) NOT NULL,
  name          VARCHAR(100) NOT NULL,
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  public_slug   VARCHAR(20),
  created_at    TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at    TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS wishlists_slug_uniq     ON wishlists (public_slug) WHERE public_slug IS NOT NULL;
CREATE INDEX        IF NOT EXISTS wishlists_customer_idx  ON wishlists (customer_gid);
CREATE UNIQUE INDEX IF NOT EXISTS wishlists_customer_name ON wishlists (customer_gid, name);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id                 SERIAL PRIMARY KEY,
  wishlist_id        INTEGER NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  shopify_product_id VARCHAR(30) NOT NULL,
  handle             VARCHAR(255) NOT NULL,
  added_at           TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS wishlist_items_unique ON wishlist_items (wishlist_id, shopify_product_id);
CREATE INDEX        IF NOT EXISTS wishlist_items_list_idx ON wishlist_items (wishlist_id);
