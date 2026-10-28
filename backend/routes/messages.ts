import { Router } from "express";
import { db } from "../db.ts";
import { parseId } from "../http.ts";
import { AgentSessionStateError, runAgentTurn } from "../agent/run-turn.ts";

// Leave pool capacity available for tools while chat requests hold advisory locks.
const activeApplications = new Set<number>();
const maxConcurrentTurns = 4;
export const router = Router();
router.post("/api/applications/:id/messages", async (request, response) => {
  const id = parseId(request.params.id);
  const message = request.body?.message;
  if (id === null) {
    response.status(400).json({ error: "Invalid application ID." }); return;
  }
  if (typeof message !== "string" || !message.trim() || message.length > 5000) {
    response.status(400).json({ error: "Message must contain between 1 and 5000 characters." }); return;
  }
  if (activeApplications.has(id)) {
    response.status(409).json({ error: "This application already has an agent request in progress." }); return;
  }
  if (activeApplications.size >= maxConcurrentTurns) {
    response.status(503).json({ error: "The agent is busy. Try again in a moment." }); return;
  }
  activeApplications.add(id);
  let client: Awaited<ReturnType<typeof db.connect>> | undefined;
  let locked = false;
  let messageSaved = false;
  const controller = new AbortController();
  const disconnected = () => { if (!response.writableEnded) controller.abort(); };
  response.on("close", disconnected);
  try {
    client = await db.connect();
    // One turn per application across backend processes; other applications can run independently.
    const lock = await client.query("SELECT pg_try_advisory_lock($1::bigint) AS locked", [id]);
    locked = lock.rows[0].locked;
    if (!locked) {
      response.status(409).json({ error: "This application already has an agent request in progress." }); return;
    }
    const application = await client.query("SELECT agent_session_id FROM applications WHERE id = $1", [id]);
    if (!application.rows.length) {
      response.status(404).json({ error: "Application not found." }); return;
    }
    controller.signal.throwIfAborted();
    await client.query(`INSERT INTO conversation_messages (application_id, role, content) VALUES ($1, 'user', $2)`, [id, message.trim()]);
    messageSaved = true;
    const { answer, sessionId } = await runAgentTurn({
      applicationId: id, sessionId: application.rows[0].agent_session_id, message: message.trim(), signal: controller.signal,
    });
    await client.query(`INSERT INTO conversation_messages (application_id, role, content, agent_session_id)
      VALUES ($1, 'assistant', $2, $3)`, [id, answer, sessionId]);
    response.json({ answer, sessionId });
  } catch (error) {
    console.error("Agent request failed:", error instanceof Error ? error.message : "Unknown error");
    if (!response.destroyed) {
      const sessionError = error instanceof AgentSessionStateError;
      response.status(sessionError ? 409 : 502).json({
        error: sessionError ? error.message : messageSaved
          ? "The agent request failed. Your message was saved; please try again."
          : "The message could not be saved. Please try again.",
      });
    }
  } finally {
    activeApplications.delete(id);
    response.off("close", disconnected);
    // Destroy the checked-out connection if unlocking fails; never return a locked connection to the pool.
    if (client) {
      try {
        if (locked) await client.query("SELECT pg_advisory_unlock($1::bigint)", [id]);
        client.release();
      } catch { client.release(true); }
    }
  }
});
