-- 032_emma_chat_threads_messages.sql
--
-- Internal Emma chat for /admin/emma-chat. One thread per Reddit post being
-- responded to; one row per message (user / assistant / tool). Append-only
-- log; assistant rows include the tool_use blocks Claude emitted, tool rows
-- include the tool_result payloads we sent back into the next turn.
--
-- Lookup pattern: load thread by id, stream messages by (thread_id, created_at).
-- Active list: where archived = false, sorted by updated_at DESC.

CREATE TABLE IF NOT EXISTS emma_chat_threads (
  id                    SERIAL PRIMARY KEY,
  title                 VARCHAR(200) NOT NULL DEFAULT 'New thread',
  reddit_post_url       TEXT,
  reddit_post_excerpt   TEXT,
  archived              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS emma_chat_threads_updated_idx
  ON emma_chat_threads (updated_at DESC);

CREATE INDEX IF NOT EXISTS emma_chat_threads_active_idx
  ON emma_chat_threads (archived, updated_at DESC)
  WHERE archived = FALSE;

CREATE TABLE IF NOT EXISTS emma_chat_messages (
  id              SERIAL PRIMARY KEY,
  thread_id       INTEGER NOT NULL REFERENCES emma_chat_threads(id) ON DELETE CASCADE,
  role            VARCHAR(10) NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  tool_calls      JSONB,
  tool_results    JSONB,
  stop_reason     VARCHAR(20),
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  latency_ms      INTEGER,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS emma_chat_messages_thread_idx
  ON emma_chat_messages (thread_id, created_at);
