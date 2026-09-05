ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_confirmed_at timestamptz;

-- Accounts created by the legacy auth flow already passed both required checks.
UPDATE users
SET terms_accepted_at = COALESCE(terms_accepted_at, created_at),
    age_confirmed_at = COALESCE(age_confirmed_at, created_at)
WHERE clerk_user_id IS NULL;
