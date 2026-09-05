import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "../db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.resolve(here, "../../sql");

async function migrate(): Promise<void> {
  const files = (await fs.readdir(sqlDir)).filter((file) => file.endsWith(".sql")).sort();
  const client = await getPool().connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const file of files) {
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
      if (applied.rowCount) continue;
      const sql = await fs.readFile(path.join(sqlDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING", [file]);
        await client.query("COMMIT");
        console.log(`Applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

migrate()
  .then(closePool)
  .catch(async (error) => {
    console.error(error);
    await closePool();
    process.exitCode = 1;
  });

