CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  timezone text NOT NULL DEFAULT 'America/Los_Angeles',
  phone_e164 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9_]{3,24}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (lower(username)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_codes_lookup ON auth_codes (lower(email), purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  user_agent text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_active ON sessions (user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS safety_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  relationship text NOT NULL,
  phone_e164 text,
  email text,
  priority integer NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 10),
  channels text[] NOT NULL DEFAULT ARRAY['sms']::text[],
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT safety_contacts_destination CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS safety_contacts_user ON safety_contacts (user_id, priority, created_at);

CREATE TABLE IF NOT EXISTS journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  origin_label text,
  destination_label text NOT NULL,
  expected_arrival_at timestamptz NOT NULL,
  check_in_interval_minutes integer NOT NULL CHECK (check_in_interval_minutes BETWEEN 10 AND 360),
  grace_minutes integer NOT NULL CHECK (grace_minutes BETWEEN 5 AND 120),
  voice_call_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'overdue', 'ended', 'cancelled')),
  notes_ciphertext text,
  share_token_hash text UNIQUE,
  share_token_ciphertext text,
  started_at timestamptz,
  ended_at timestamptz,
  last_check_in_at timestamptz,
  next_check_in_at timestamptz,
  last_coarse_area text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journeys_user_recent ON journeys (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS journeys_due ON journeys (next_check_in_at) WHERE status IN ('active', 'overdue');

CREATE TABLE IF NOT EXISTS journey_contacts (
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES safety_contacts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (journey_id, contact_id)
);

CREATE TABLE IF NOT EXISTS journey_locations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters double precision,
  coarse_area text,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journey_locations_recent ON journey_locations (journey_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS journey_locations_retention ON journey_locations (created_at);

CREATE TABLE IF NOT EXISTS journey_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journey_id uuid REFERENCES journeys(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journey_events_journey ON journey_events (journey_id, created_at DESC);
CREATE INDEX IF NOT EXISTS journey_events_retention ON journey_events (created_at);

CREATE TABLE IF NOT EXISTS device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_tokens_user ON device_tokens (user_id) WHERE enabled = true;

CREATE TABLE IF NOT EXISTS escalation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES safety_contacts(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('traveler_push', 'traveler_voice', 'contact_notice', 'manual_alert')),
  channel text NOT NULL CHECK (channel IN ('push', 'voice', 'sms', 'email')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  provider_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS escalation_actions_due ON escalation_actions (next_attempt_at) WHERE status IN ('pending', 'failed');
