-- 126: durable log of orders/fulfilled webhook outcomes (ticket #16267).
--
-- handleOrderFulfilled (server/webhooks.ts) returns early, logging only to
-- console, when a fulfilled order's payload carries no usable email (the
-- Basic plan's PII redaction empties order.email/contact_email/customer.email
-- on every order). 0 of 38 recent fulfilled orders produced a review invite,
-- and nothing durable recorded that this had happened, so the silent drop ran
-- unnoticed. This table gives every invocation a row, so a stretch of
-- fulfilled orders with zero invites created shows up in the data instead of
-- only in function logs that roll off.
--
-- Additive only (new table + index, no DML): applies unattended on the
-- ordinary migration lane.

CREATE TABLE IF NOT EXISTS order_fulfillment_webhook_log (
  id BIGSERIAL PRIMARY KEY,
  shopify_order_id TEXT NOT NULL,
  outcome TEXT NOT NULL
    CHECK (outcome IN ('invited', 'no_email_pii_redacted', 'no_line_items', 'no_invite_created')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_fulfillment_webhook_log_created_at_idx
  ON order_fulfillment_webhook_log (created_at);
