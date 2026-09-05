CREATE UNIQUE INDEX IF NOT EXISTS journeys_one_active_per_user
  ON journeys (user_id)
  WHERE status IN ('active', 'overdue');
