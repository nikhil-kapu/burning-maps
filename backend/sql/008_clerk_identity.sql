ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_user_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_password_enabled boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_user_unique
  ON users (clerk_user_id)
  WHERE clerk_user_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS clerk_session_id text;
CREATE INDEX IF NOT EXISTS sessions_clerk_session_active
  ON sessions (clerk_session_id)
  WHERE clerk_session_id IS NOT NULL AND revoked_at IS NULL;
