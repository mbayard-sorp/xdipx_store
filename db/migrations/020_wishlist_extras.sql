ALTER TABLE wishlists
  ADD COLUMN IF NOT EXISTS note         TEXT,
  ADD COLUMN IF NOT EXISTS privacy      VARCHAR(20)  NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS gift_mode    BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS share_token  VARCHAR(48);

CREATE UNIQUE INDEX IF NOT EXISTS wishlists_share_token_uniq
  ON wishlists (share_token)
  WHERE share_token IS NOT NULL;

ALTER TABLE wishlist_items
  ADD COLUMN IF NOT EXISTS variant_selection JSON;
