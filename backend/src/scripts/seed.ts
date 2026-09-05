import { closePool, getPool } from "../db.js";
import { hashPassword } from "../security.js";

async function seed(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Seed script is disabled in production.");
  const passwordHash = await hashPassword("TurtleDemo!2026");
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO users (username, email, display_name, password_hash, email_verified_at)
     VALUES ('demo_traveler', 'demo@turtlebuddy.app', 'Maya', $1, now())
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [passwordHash],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    console.log("Demo user already exists.");
    return;
  }
  await getPool().query(
    `INSERT INTO safety_contacts (user_id, name, relationship, phone_e164, email, priority, channels)
     VALUES ($1, 'Ari', 'Sister', '+15555550101', 'ari@example.com', 1, ARRAY['sms','email'])`,
    [id],
  );
  console.log("Seeded demo@turtlebuddy.app / TurtleDemo!2026");
}

seed().then(closePool).catch(async (error) => {
  console.error(error);
  await closePool();
  process.exitCode = 1;
});

