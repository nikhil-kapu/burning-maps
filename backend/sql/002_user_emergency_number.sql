ALTER TABLE users
  ADD COLUMN IF NOT EXISTS emergency_number text;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_emergency_number_format;

ALTER TABLE users
  ADD CONSTRAINT users_emergency_number_format
  CHECK (emergency_number IS NULL OR emergency_number ~ '^[0-9+*#]{2,20}$');
