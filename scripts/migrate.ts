import { readFile } from "node:fs/promises";
import { db } from "../backend/db.ts";

// Existing baseline is adopted without recreating or resetting any tables.
const files = ["schema.sql", "002_applications.sql", "003_application_documents.sql", "004_form_suggestions.sql", "005_runtime.sql", "006_part_one.sql", "007_provision_attributions.sql", "008_review_workflow.sql", "009_demo_sessions.sql"];
const client = await db.connect();
try {
  await client.query("SELECT pg_advisory_lock(18452, 1)");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  for (const file of files) {
    const applied = await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [file]);
    if (applied.rows.length) continue;
    const baseline = file === "schema.sql" && (await client.query("SELECT to_regclass('public.documents') AS name")).rows[0].name;
    await client.query("BEGIN");
    try {
      if (!baseline) {
        const sql = (await readFile(new URL(`../database/${file}`, import.meta.url), "utf8"))
          .replace(/^BEGIN;\s*/i, "").replace(/COMMIT;\s*$/i, "");
        await client.query(sql);
      }
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`${baseline ? "Adopted existing" : "Applied"}: ${file}`);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  }
} catch (error) {
  console.error("Migration failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally {
  try { await client.query("SELECT pg_advisory_unlock(18452, 1)"); }
  finally { client.release(); await db.end(); }
}
