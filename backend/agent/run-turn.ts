import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { db } from "../db.ts";
import { agentConfig } from "./config.ts";
import { createToolHandlers } from "./tools.ts";

export class AgentSessionStateError extends Error {}

export type AgentTurnOptions = {
  applicationId: number;
  sessionId: string | null;
  message: string;
  signal?: AbortSignal;
};

type AgentTurnDependencies = {
  openai?: OpenAI;
  executeTool?: ReturnType<typeof createToolHandlers>;
  saveSession?: (id: string) => Promise<void>;
};

export async function runAgentTurn(opts: AgentTurnOptions, deps: AgentTurnDependencies = {}): Promise<{ answer: string; sessionId: string }> {
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000);
  signal.throwIfAborted();
  const openai = deps.openai ?? new OpenAI({ maxRetries: 0 });
  const executeTool = deps.executeTool ?? createToolHandlers(opts.applicationId, signal);
  let sessionId = opts.sessionId;
  let turnCompleted = false;
  const completedCalls = new Set<string>();
  const outputParts = new Map<string, string>();
  if (sessionId) {
    const session = await openai.beta.agents.sessions.retrieve(sessionId, { signal });
    if (session.status !== "idle") {
      throw new AgentSessionStateError(session.status === "failed" ? "The saved agent session has failed. Start a new application to continue."
        : "The previous agent turn is still stopping. Wait a moment before sending another message.");
    }
  }
  const events = sessionId
    ? await openai.beta.agents.sessions.events.stream(sessionId, { signal })
    : await openai.beta.agents.sessions.create({ agent: agentConfig,
        environment: { type: "none" }, input: opts.message, stream: true }, { signal });
  const saveSession = async (id: string) => {
    sessionId = id;
    // Persist immediately, even when a later tool or model call fails.
    if (deps.saveSession) await deps.saveSession(id);
    else await db.query("UPDATE applications SET agent_session_id = $1 WHERE id = $2", [id, opts.applicationId]);
  };
  try {
    if (opts.sessionId) {
      await openai.beta.agents.sessions.events.create(opts.sessionId, {
        "Idempotency-Key": randomUUID(),
        events: [{ type: "agent.session.input.message", input: [{ role: "user", content: [{ type: "input_text", text: opts.message }] }] }],
      }, { signal });
    }
    for await (const event of events) {
      signal.throwIfAborted();
      if (event.type === "agent.session.created") await saveSession(event.session.id);
      if (event.type === "agent.session.turn.output_text.delta" || event.type === "agent.session.turn.output_text.done") {
        const key = `${event.item_id}:${event.output_index}:${event.content_index}`;
        outputParts.set(key, event.type === "agent.session.turn.output_text.done" ? event.text : (outputParts.get(key) ?? "") + event.delta);
      }
      if (event.type === "agent.session.requires_action") {
        if (sessionId !== event.session.id) await saveSession(event.session.id);
        for (const action of event.session.required_actions ?? []) {
          if (action.type !== "function_call") throw new Error(`Unsupported required action: ${action.type}`);
          if (completedCalls.has(action.call_id)) continue;
          let outcome;
          try {
            const args: unknown = typeof action.arguments === "string" ? JSON.parse(action.arguments) : action.arguments;
            outcome = { success: true as const, output: await executeTool(action.name, args) };
          } catch (error) {
            signal.throwIfAborted();
            outcome = { success: false as const, error: error instanceof Error ? error.message : "Tool failed." };
          }
          await openai.beta.agents.sessions.events.create(event.session.id, {
            events: [{ type: "agent.session.input.tool_result", turn_id: action.turn_id, call_id: action.call_id, ...outcome }],
          }, { signal });
          completedCalls.add(action.call_id);
        }
      }
      if (event.type === "error") throw new Error(event.error.message);
      if (event.type === "agent.session.environment.failed") throw new Error("The agent environment failed.");
      if (event.type === "agent.session.failed") throw new Error("The agent session failed.");
      if (event.type === "agent.session.turn.failed" && event.turn.subagent_id === null)
        throw new Error(event.turn.error?.message ?? "The agent turn failed.");
      if (event.type === "agent.session.turn.cancelled" && event.turn.subagent_id === null)
        throw new Error("The agent turn was cancelled.");
      if (event.type === "agent.session.turn.completed" && event.turn.subagent_id === null) {
        turnCompleted = true;
        break;
      }
    }
    if (!turnCompleted) throw new Error("The event stream ended before the agent turn completed.");
    if (!sessionId) throw new Error("The agent session ID was not received.");
    const answer = [...outputParts.values()].join("\n").trim();
    if (!answer) throw new Error("The agent completed without a text response.");
    return { answer, sessionId };
  } catch (error) {
    if (sessionId && !turnCompleted) {
      // Closing a stream alone does not stop remote work. Cancel before allowing another message.
      try {
        await openai.beta.agents.sessions.events.create(sessionId, {
          events: [{ type: "agent.session.input.cancel" }],
        }, { signal: AbortSignal.timeout(10_000) });
      } catch { console.error("Could not cancel the interrupted agent turn."); }
    }
    throw error;
  } finally { events.controller.abort(); }
}
