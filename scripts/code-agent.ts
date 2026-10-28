import { db } from "../backend/db.ts";
import { runAgentTurn } from "../backend/agent/run-turn.ts";

// Optional CLI wrapper; the HTTP server imports runAgentTurn directly.
const message = process.argv.slice(2).join(" ").trim();
const applicationId = Number(process.env.APPLICATION_ID);
try {
  if (!message || !Number.isSafeInteger(applicationId) || applicationId < 1)
    throw new Error('Usage: APPLICATION_ID=<id> npx tsx scripts/code-agent.ts "Your question"');
  const result = await db.query("SELECT agent_session_id FROM applications WHERE id = $1", [applicationId]);
  if (!result.rows.length) throw new Error("Application not found.");
  const turn = await runAgentTurn({ applicationId, sessionId: result.rows[0].agent_session_id, message });
  console.log(turn.answer);
} catch (error) {
  console.error("Agent failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally { await db.end(); }
