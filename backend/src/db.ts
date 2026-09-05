import pg from "pg";
import { getConfig } from "./config.js";

const { Pool } = pg;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getConfig().DATABASE_URL,
      max: getConfig().NODE_ENV === "production" ? 20 : 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "turtle-buddy-api",
    });
    pool.on("error", (error) => {
      console.error("Unexpected PostgreSQL pool error", { message: error.message });
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) await pool.end();
  pool = undefined;
}

export async function healthcheckDatabase(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
