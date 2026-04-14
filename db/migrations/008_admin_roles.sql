CREATE TABLE IF NOT EXISTS admin_roles (
  id               SERIAL PRIMARY KEY,
  neon_auth_user_id VARCHAR(60) NOT NULL UNIQUE,
  email            VARCHAR(255) NOT NULL,
  name             VARCHAR(100) NOT NULL,
  role             VARCHAR(20) NOT NULL DEFAULT 'admin',
  created_at       TIMESTAMP DEFAULT NOW() NOT NULL,
  last_login_at    TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_roles_neon_auth_user_id ON admin_roles (neon_auth_user_id);
