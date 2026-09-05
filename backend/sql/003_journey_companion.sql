ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS destination_latitude double precision,
  ADD COLUMN IF NOT EXISTS destination_longitude double precision,
  ADD COLUMN IF NOT EXISTS travel_mode text NOT NULL DEFAULT 'driving',
  ADD COLUMN IF NOT EXISTS journey_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS companion_updates_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS companion_call_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS update_delay_threshold_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS route_baseline_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS route_baseline_eta_at timestamptz,
  ADD COLUMN IF NOT EXISTS route_last_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS route_last_distance_meters integer,
  ADD COLUMN IF NOT EXISTS route_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS route_last_update_call_at timestamptz,
  ADD COLUMN IF NOT EXISTS route_last_signature text,
  ADD COLUMN IF NOT EXISTS last_companion_update text,
  ADD COLUMN IF NOT EXISTS last_companion_update_at timestamptz;

ALTER TABLE journeys DROP CONSTRAINT IF EXISTS journeys_destination_latitude_check;
ALTER TABLE journeys ADD CONSTRAINT journeys_destination_latitude_check
  CHECK (destination_latitude IS NULL OR destination_latitude BETWEEN -90 AND 90);

ALTER TABLE journeys DROP CONSTRAINT IF EXISTS journeys_destination_longitude_check;
ALTER TABLE journeys ADD CONSTRAINT journeys_destination_longitude_check
  CHECK (destination_longitude IS NULL OR destination_longitude BETWEEN -180 AND 180);

ALTER TABLE journeys DROP CONSTRAINT IF EXISTS journeys_travel_mode_check;
ALTER TABLE journeys ADD CONSTRAINT journeys_travel_mode_check
  CHECK (travel_mode IN ('driving', 'public_transit', 'bus', 'subway', 'train', 'taxi', 'rideshare', 'walking', 'cycling'));

ALTER TABLE journeys DROP CONSTRAINT IF EXISTS journeys_update_delay_threshold_check;
ALTER TABLE journeys ADD CONSTRAINT journeys_update_delay_threshold_check
  CHECK (update_delay_threshold_minutes BETWEEN 5 AND 120);

ALTER TABLE escalation_actions
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE escalation_actions DROP CONSTRAINT IF EXISTS escalation_actions_stage_check;
ALTER TABLE escalation_actions ADD CONSTRAINT escalation_actions_stage_check
  CHECK (stage IN ('traveler_push', 'traveler_voice', 'contact_notice', 'manual_alert', 'journey_update'));

CREATE INDEX IF NOT EXISTS journeys_route_monitor_due
  ON journeys (route_last_checked_at)
  WHERE status IN ('active', 'overdue') AND companion_updates_enabled = true;
