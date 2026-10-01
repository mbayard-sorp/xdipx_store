-- 111: per-order acquisition attribution (ticket #12669, owner all-hands
-- 2026-09-30 ChatGPT audit). Orders #1005 and #1008 carry _utm_source=chatgpt.com
-- on note_attributes, but nothing persisted it, so daily_profit_summary, the
-- owner digest, and the weekly strategy brief could not say which channel
-- produced an order, and GA4 is blind too (checkout completes off-domain on
-- shop.app / shop.xdipx.com). One row per order, written best-effort from
-- orders/create; a write failure here costs attribution, never the order
-- itself. Fully additive.
CREATE TABLE IF NOT EXISTS order_attribution (
  shopify_order_id text PRIMARY KEY,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_content      text,
  ref_code         text,
  referring_site   text,
  landing_site     text,
  source_name      text,
  channel_group    varchar(24) NOT NULL,
  total_price      numeric(10,2),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_attribution_channel_group ON order_attribution(channel_group);
CREATE INDEX IF NOT EXISTS idx_order_attribution_created_at ON order_attribution(created_at);
