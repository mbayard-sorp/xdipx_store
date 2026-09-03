-- 093_social_comments.sql
-- Ticket #2027: Instagram comment support lane, phase 1 (owner direction
-- 2026-08-08: "yes, we need a support team to reply to comments"). Read+draft
-- seam: ingest inbound Instagram comments, let an admin draft/edit a reply in
-- the /admin/socials/comments queue, and post an approved reply via the
-- Instagram Graph API. Auto-reply is out of scope here (phase 2, separate
-- ticket, off by default).
--
-- external_comment_id is unique so an hourly ingest tick is a plain upsert:
-- re-fetching the same comment window never duplicates a row.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
-- only. No DROP, no RENAME, no ALTER TYPE, no DML. Merges on the ordinary
-- release-engine lane once migration-dry-run is green.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 093
-- (also applies automatically at build time via
-- scripts/apply-additive-migrations.ts, since every statement here is
-- additive)
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS social_comments (
  id                  SERIAL PRIMARY KEY,
  external_comment_id VARCHAR(60) NOT NULL,
  external_post_id    VARCHAR(60) NOT NULL,
  platform            VARCHAR(20) NOT NULL DEFAULT 'instagram',
  username             VARCHAR(120),
  text                 TEXT NOT NULL,
  commented_at         TIMESTAMP,
  fetched_at           TIMESTAMP NOT NULL DEFAULT now(),
  status               VARCHAR(20) NOT NULL DEFAULT 'inbound',
  reply_text           TEXT,
  replied_at           TIMESTAMP,
  replied_by           VARCHAR(60),
  external_reply_id    VARCHAR(60),
  created_at           TIMESTAMP NOT NULL DEFAULT now(),
  updated_at           TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_comments_external_id
  ON social_comments (external_comment_id);

CREATE INDEX IF NOT EXISTS idx_social_comments_status
  ON social_comments (status);
