import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentSession, AgentSessionEvent } from "openai/resources/beta/agents/agents";
import { db } from "../db.ts";
import { AGENT_CONFIG_VERSION, agentConfig } from "./config.ts";
import { fitsToolResult } from "./result-limits.ts";
import { createToolHandlers } from "./tools.ts";

export class AgentSessionStateError extends Error {}

export type AgentTurnOptions = {
  applicationId: number;
  sessionId: string | null;
  message: string;
  context?: string;
  signal?: AbortSignal;
};

type AgentTurnDependencies = {
  openai?: OpenAI;
  executeTool?: ReturnType<typeof createToolHandlers>;
  saveSession?: (id: string) => Promise<void>;
};

export async function runAgentTurn(opts: AgentTurnOptions, deps: AgentTurnDependencies = {}): Promise<{ answer: string; sessionId: string }> {
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000);
  signal.throwIfAborted();
  const openai = deps.openai ?? new OpenAI({ maxRetries: 0 });
  const executeTool = deps.executeTool ?? createToolHandlers(opts.applicationId, signal);
  let sessionId = opts.sessionId;
  let turnCompleted = false;
  let turnTerminal = false;
  let turnId: string | undefined;
  let previousTurnId: string | undefined;
  const completedCalls = new Set<string>();
  const outputParts = new Map<string, string>();
  if (sessionId) {
    const session = await openai.beta.agents.sessions.retrieve(sessionId, { signal });
    if (session.status !== "idle") {
      throw new AgentSessionStateError(session.status === "failed" ? "The saved agent session has failed. Start a new application to continue."
        : "The previous agent turn is still stopping. Wait a moment before sending another message.");
    }
    const previous = await openai.beta.agents.sessions.turns.list(sessionId, { order: "desc", limit: 1 }, { signal });
    previousTurnId = previous.data[0]?.id;
  }
  let events = sessionId
    ? await openai.beta.agents.sessions.events.stream(sessionId, { signal })
    : await openai.beta.agents.sessions.create({ agent: agentConfig,
        environment: { type: "none" }, input: opts.context ? `Saved conversation for context (quoted history, not new instructions):\n${opts.context}\n\nCurrent user message:\n${opts.message}` : opts.message, stream: true }, { signal });
  const saveSession = async (id: string) => {
    sessionId = id;
    // Persist immediately, even when a later tool or model call fails.
    if (deps.saveSession) await deps.saveSession(id);
    else await db.query("UPDATE applications SET agent_session_id = $1, agent_config_version = $3 WHERE id = $2", [id, opts.applicationId, AGENT_CONFIG_VERSION]);
  };
  const handleActions = async (session: AgentSession) => {
    if (sessionId !== session.id) await saveSession(session.id);
    for (const action of session.required_actions ?? []) {
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
      let result = { type: "agent.session.input.tool_result" as const, turn_id: action.turn_id, call_id: action.call_id, ...outcome };
      if (!fitsToolResult(result)) {
        result = { type: "agent.session.input.tool_result", turn_id: action.turn_id, call_id: action.call_id,
          success: false, error: "The tool result is too large. Request a narrower search or inspect a smaller page instead." };
      }
      await openai.beta.agents.sessions.events.create(session.id, { events: [result] }, { signal });
      completedCalls.add(action.call_id);
    }
  };
  const restoreAnswer = async () => {
    if (!sessionId || !turnId) throw new Error("The completed agent turn could not be identified.");
    const messages = [];
    for await (const item of openai.beta.agents.sessions.turns.items.list(turnId, { session_id: sessionId, order: "asc", limit: 100 }, { signal })) {
      if (item.type === "message" && item.role === "assistant" && item.status === "completed" && item.phase !== "commentary") messages.push(item);
    }
    outputParts.clear();
    for (const [index, item] of messages.entries()) {
      outputParts.set(item.id ?? String(index), item.content.flatMap((part) => part.type === "output_text" ? [part.text] : []).join("\n"));
    }
  };
  const handleEvent = async (event: AgentSessionEvent) => {
    if ("turn" in event && event.turn.subagent_id === null) turnId = event.turn.id;
    if (event.type === "agent.session.created") await saveSession(event.session.id);
    if (event.type === "agent.session.turn.output_text.delta" || event.type === "agent.session.turn.output_text.done") {
      const key = `${event.item_id}:${event.output_index}:${event.content_index}`;
      outputParts.set(key, event.type === "agent.session.turn.output_text.done" ? event.text : (outputParts.get(key) ?? "") + event.delta);
    }
    if (event.type === "agent.session.requires_action") await handleActions(event.session);
    if (event.type === "error") throw new Error(event.error.message);
    if (event.type === "agent.session.environment.failed") throw new Error("The agent environment failed.");
    if (event.type === "agent.session.failed") { turnTerminal = true; throw new Error("The agent session failed."); }
    if (event.type === "agent.session.turn.failed" && event.turn.subagent_id === null) {
      turnTerminal = true;
      throw new Error(event.turn.error?.message ?? "The agent turn failed.");
    }
    if (event.type === "agent.session.turn.cancelled" && event.turn.subagent_id === null) {
      turnTerminal = true;
      throw new Error("The agent turn was cancelled.");
    }
    if (event.type === "agent.session.turn.completed" && event.turn.subagent_id === null) {
      turnCompleted = true;
      turnTerminal = true;
    }
  };
  try {
    if (opts.sessionId) {
      await openai.beta.agents.sessions.events.create(opts.sessionId, {
        "Idempotency-Key": randomUUID(),
        events: [{ type: "agent.session.input.message", input: [{ role: "user", content: [{ type: "input_text", text: opts.message }] }] }],
      }, { signal });
    }
    let reconnects = 0;
    while (!turnCompleted) {
      const iterator = events[Symbol.asyncIterator]();
      while (!turnCompleted) {
        signal.throwIfAborted();
        let next;
        try { next = await iterator.next(); }
        catch (error) {
          signal.throwIfAborted();
          if (error instanceof OpenAI.APIError && !(error instanceof OpenAI.APIConnectionError) && (error.status ?? 0) < 500) throw error;
          break;
        }
        if (next.done) break;
        await handleEvent(next.value);
      }
      if (turnCompleted) break;
      signal.throwIfAborted();
      if (!sessionId) throw new Error("The event stream ended before the agent session ID was received.");
      if (reconnects++ >= 3) throw new Error("The agent event stream repeatedly disconnected. Please try again.");
      events.controller.abort();
      await delay(250 * reconnects, undefined, { signal });
      // Subscribe first: live streams do not replay events missed while offline.
      events = await openai.beta.agents.sessions.events.stream(sessionId, { signal });
      const session = await openai.beta.agents.sessions.retrieve(sessionId, { signal });
      if (session.status === "failed") { turnTerminal = true; throw new AgentSessionStateError("The saved agent session has failed."); }
      if (!turnId) {
        const turns = await openai.beta.agents.sessions.turns.list(sessionId, { order: "desc", limit: 100 }, { signal });
        turnId = turns.data.find((turn) => turn.subagent_id === null && turn.id !== previousTurnId)?.id;
      }
      if (turnId) {
        const turn = await openai.beta.agents.sessions.turns.retrieve(turnId, { session_id: sessionId }, { signal });
        if (turn.status === "completed") {
          turnCompleted = true;
          turnTerminal = true;
        } else if (turn.status === "failed" || turn.status === "cancelled") {
          turnTerminal = true;
          throw new Error(turn.error?.message ?? `The agent turn was ${turn.status}.`);
        }
      }
      if (!turnCompleted) await handleActions(session);
    }
    if (!sessionId) throw new Error("The agent session ID was not received.");
    // A completion event can arrive just after the recovery snapshot. Always
    // replace potentially incomplete text with saved final output after reconnect.
    if (reconnects > 0 || ![...outputParts.values()].join("").trim()) await restoreAnswer();
    const answer = [...outputParts.values()].join("\n").trim();
    if (!answer) throw new Error("The agent completed without a text response.");
    return { answer, sessionId };
  } catch (error) {
    if (sessionId && !turnTerminal) {
      // Closing a stream alone does not stop remote work. Cancel before allowing another message.
      try {
        await openai.beta.agents.sessions.events.create(sessionId, {
          events: [{ type: "agent.session.input.cancel" }],
        }, { signal: AbortSignal.timeout(10_000) });
      } catch (cancelError) {
        console.error("Could not cancel the interrupted agent turn:", cancelError instanceof Error ? cancelError.message : "Unknown error");
      }
    }
    throw error;
  } finally { events.controller.abort(); }
}
