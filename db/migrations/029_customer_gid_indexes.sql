-- Phase 10: customer_gid indexes on both conversation tables.
-- Queries that search by customer_gid previously did full-table scans.
-- All four indexes are partial (WHERE customer_gid IS NOT NULL) to keep
-- the index tight — the majority of rows will eventually have a GID but
-- anonymous rows should not bloat the index.

CREATE INDEX IF NOT EXISTS sms_conversations_customer_gid_idx
  ON sms_conversations (customer_gid)
  WHERE customer_gid IS NOT NULL;

CREATE INDEX IF NOT EXISTS web_conversations_customer_gid_idx
  ON web_conversations (customer_gid)
  WHERE customer_gid IS NOT NULL;

CREATE INDEX IF NOT EXISTS sms_conversations_gid_active_idx
  ON sms_conversations (customer_gid, last_active_at DESC)
  WHERE customer_gid IS NOT NULL;

CREATE INDEX IF NOT EXISTS web_conversations_gid_active_idx
  ON web_conversations (customer_gid, last_active_at DESC)
  WHERE customer_gid IS NOT NULL;
