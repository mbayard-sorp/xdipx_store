CREATE TABLE IF NOT EXISTS emma_chat_sessions (
  id                    SERIAL PRIMARY KEY,
  cookie_id             VARCHAR(40) NOT NULL,
  customer_gid          VARCHAR(60),
  ip_hash               VARCHAR(64),
  user_agent            VARCHAR(255),
  turn_count            INTEGER NOT NULL DEFAULT 0,
  first_product_handle  VARCHAR(255),
  checkout_url_shared   TEXT,
  checkout_shared_at    TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  last_activity_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS emma_sessions_cookie_uniq ON emma_chat_sessions (cookie_id);
CREATE INDEX IF NOT EXISTS emma_sessions_customer_idx ON emma_chat_sessions (customer_gid);
CREATE INDEX IF NOT EXISTS emma_sessions_created_idx ON emma_chat_sessions (created_at);

CREATE TABLE IF NOT EXISTS emma_chat_turns (
  id          SERIAL PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES emma_chat_sessions(id) ON DELETE CASCADE,
  role        VARCHAR(10) NOT NULL,
  text        TEXT NOT NULL,
  hidden      BOOLEAN NOT NULL DEFAULT FALSE,
  products    JSON,
  quick_reply JSON,
  latency_ms  INTEGER,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS emma_turns_session_idx ON emma_chat_turns (session_id, created_at);

CREATE TABLE IF NOT EXISTS emma_chat_events (
  id         SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES emma_chat_sessions(id) ON DELETE CASCADE,
  turn_id    INTEGER,
  kind       VARCHAR(30) NOT NULL,
  payload    JSON,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS emma_events_session_idx ON emma_chat_events (session_id, created_at);
CREATE INDEX IF NOT EXISTS emma_events_kind_idx ON emma_chat_events (kind, created_at);
