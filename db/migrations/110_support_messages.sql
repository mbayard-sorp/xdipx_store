-- 110: inbound support-email pipeline (ticket #12095, tracker p2-4-support).
-- One row per genuine inbound message at hello@xdipx.com (outreach-thread
-- replies are handled separately by outreach_messages and never land here)
-- plus the draft-only reply customer-service-emma's prompt produced. Nothing
-- writes here except the read-only IMAP poller in support-inbox.server.ts;
-- draft_reply is never sent automatically. Fully additive.
CREATE TABLE IF NOT EXISTS support_messages (
  id serial PRIMARY KEY,
  message_id text NOT NULL,
  from_email text,
  subject text,
  body_text text,
  draft_reply text NOT NULL,
  needs_human_review boolean NOT NULL DEFAULT false,
  received_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_messages_message_id ON support_messages(message_id);
