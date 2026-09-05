ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS agent_instructions_ciphertext text;

