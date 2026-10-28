import { readFile } from "node:fs/promises";
import { db } from "../backend/db.ts";
import { importCandidates, recordAttributionReview } from "../backend/attribution-import.ts";
const reviewing = process.argv[2] === "--review";
const path = process.argv[reviewing ? 3 : 2];
let client: Awaited<ReturnType<typeof db.connect>> | undefined;
try {
  if (!path) throw new Error("Usage: npm run db:attributions -- [--review] <dataset-or-review.json>");
  const data = JSON.parse(await readFile(path, "utf8"));
  client = await db.connect();
  await client.query("BEGIN");
  if (reviewing) {
    await recordAttributionReview(client, data);
    console.log("Recorded the supplied external review. Cross-edition compatibility requires its own explicit evidence.");
  } else {
    const count = await importCandidates(client, data);
    console.log(`Imported ${count} new candidates; none were automatically verified. Edition compatibility remains unverified.`);
  }
  await client.query("COMMIT");
} catch (error) {
  if (client) await client.query("ROLLBACK");
  console.error("Attribution import/review failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally { client?.release(); await db.end(); }
