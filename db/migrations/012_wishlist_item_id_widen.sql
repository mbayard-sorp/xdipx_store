-- Widen wishlist_items.shopify_product_id to fit Shopify GIDs.
-- Shopify product GIDs look like "gid://shopify/Product/1234567890123"
-- which exceeds the original VARCHAR(30). Use VARCHAR(64) to be safe.

ALTER TABLE wishlist_items
  ALTER COLUMN shopify_product_id TYPE VARCHAR(64);
