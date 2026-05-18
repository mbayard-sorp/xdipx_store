-- Migration 037: add nullable session_id to emma_chat_threads for public anonymous discovery chat
ALTER TABLE emma_chat_threads ADD COLUMN IF NOT EXISTS session_id TEXT;
CREATE INDEX IF NOT EXISTS emma_chat_threads_session_id_idx ON emma_chat_threads(session_id);
