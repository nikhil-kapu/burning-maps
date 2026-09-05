ALTER TABLE escalation_actions DROP CONSTRAINT IF EXISTS escalation_actions_status_check;
ALTER TABLE escalation_actions ADD CONSTRAINT escalation_actions_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'simulated', 'failed', 'cancelled'));
