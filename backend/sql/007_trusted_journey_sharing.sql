ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE IF NOT EXISTS auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('apple', 'google')),
  provider_subject text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS auth_identities_user ON auth_identities (user_id);

CREATE TABLE IF NOT EXISTS journey_share_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES safety_contacts(id) ON DELETE SET NULL,
  recipient_name text NOT NULL,
  recipient_phone_e164 text,
  recipient_email text,
  token_hash text NOT NULL UNIQUE,
  token_ciphertext text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  recipient_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journey_share_invitation_destination CHECK (recipient_phone_e164 IS NOT NULL OR recipient_email IS NOT NULL),
  UNIQUE (journey_id, contact_id)
);

CREATE INDEX IF NOT EXISTS journey_share_invitations_recipient
  ON journey_share_invitations (recipient_user_id, created_at DESC)
  WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS journey_share_invitations_expiry
  ON journey_share_invitations (expires_at)
  WHERE status = 'pending';

ALTER TABLE escalation_actions
  ADD COLUMN IF NOT EXISTS invitation_id uuid REFERENCES journey_share_invitations(id) ON DELETE CASCADE;

ALTER TABLE escalation_actions DROP CONSTRAINT IF EXISTS escalation_actions_stage_check;
ALTER TABLE escalation_actions ADD CONSTRAINT escalation_actions_stage_check
  CHECK (stage IN ('traveler_push', 'traveler_voice', 'contact_notice', 'manual_alert', 'journey_update', 'journey_share'));
