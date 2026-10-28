import assert from "node:assert/strict";
import { test } from "node:test";
import type OpenAI from "openai";
import { runAgentTurn } from "../backend/agent/run-turn.ts";

type Event = Record<string, unknown>;
function fakeClient(events: Event[], status = "idle") {
  const sent: Array<{ id: string; body: any }> = [];
  const order: string[] = [];
  const controller = new AbortController();
  const stream = {
    controller,
    async *[Symbol.asyncIterator]() { yield* events; },
  };
  const client = {
    beta: { agents: { sessions: {
      retrieve: async () => ({ status }),
      create: async () => { order.push("create"); return stream; },
      events: {
        stream: async () => { order.push("subscribe"); return stream; },
        create: async (id: string, body: unknown) => { order.push("send"); sent.push({ id, body }); },
      },
    } } },
  } as unknown as OpenAI;
  return { client, sent, order, controller };
}
const created = { type: "agent.session.created", session: { id: "session-test" } };
const output = { item_id: "message-1", output_index: 0, content_index: 0 };
const done = { type: "agent.session.turn.completed", turn: { subagent_id: null } };
const opts = { applicationId: 1, sessionId: null, message: "Owner is Jane" };

test("new session is persisted before completion; final text replaces deltas; tools execute once", async () => {
  const action = { type: "function_call", name: "search_code", arguments: '{"query":"stairs"}', call_id: "call-1", turn_id: "turn-1" };
  const required = { type: "agent.session.requires_action", session: { id: "session-test", required_actions: [action] } };
  const fake = fakeClient([created, required, required,
    { type: "agent.session.turn.output_text.delta", ...output, delta: "partial" },
    { type: "agent.session.turn.output_text.done", ...output, text: "Final answer" },
    { type: "agent.session.turn.completed", turn: { subagent_id: "child" } }, done]);
  const saved: string[] = [];
  let calls = 0;
  const result = await runAgentTurn(opts, { openai: fake.client,
    saveSession: async (id) => { saved.push(id); },
    executeTool: async (name, args) => { assert.deepEqual(saved, ["session-test"]); assert.equal(name, "search_code"); assert.deepEqual(args, { query: "stairs" }); calls++; return "[]"; },
  });
  assert.deepEqual(result, { answer: "Final answer", sessionId: "session-test" });
  assert.equal(calls, 1);
  assert.equal(fake.sent.length, 1);
  assert.equal(fake.sent[0].body.events[0].type, "agent.session.input.tool_result");
  assert.ok(fake.controller.signal.aborted);
});

test("resumed sessions subscribe before sending new input", async () => {
  const fake = fakeClient([{ type: "agent.session.turn.output_text.done", ...output, text: "Continued" }, done]);
  const result = await runAgentTurn({ ...opts, sessionId: "saved-session" }, { openai: fake.client });
  assert.equal(result.sessionId, "saved-session");
  assert.deepEqual(fake.order, ["subscribe", "send"]);
  assert.equal(fake.sent[0].id, "saved-session");
  assert.ok(fake.sent[0].body["Idempotency-Key"]);
});

test("premature stream closure preserves the session and sends remote cancellation", async () => {
  const fake = fakeClient([created]);
  const saved: string[] = [];
  await assert.rejects(runAgentTurn(opts, { openai: fake.client, saveSession: async (id) => { saved.push(id); } }), /stream ended/);
  assert.deepEqual(saved, ["session-test"]);
  assert.equal(fake.sent[0].body.events[0].type, "agent.session.input.cancel");
  assert.ok(fake.controller.signal.aborted);
});

test("malformed tool arguments return a tool failure without discarding the session", async () => {
  const fake = fakeClient([created, { type: "agent.session.requires_action", session: { id: "session-test", required_actions: [
    { type: "function_call", name: "search_code", arguments: "{invalid", call_id: "bad-call", turn_id: "turn-1" },
  ] } }, { type: "agent.session.turn.output_text.done", ...output, text: "Please clarify" }, done]);
  await runAgentTurn(opts, { openai: fake.client, saveSession: async () => undefined });
  const result = fake.sent[0].body.events[0];
  assert.equal(result.success, false);
  assert.equal(result.call_id, "bad-call");
});

test("an already running remote session is never steered by a retry", async () => {
  const fake = fakeClient([], "in_progress");
  await assert.rejects(runAgentTurn({ ...opts, sessionId: "saved-session" }, { openai: fake.client }), /still stopping/);
  assert.equal(fake.sent.length, 0);
});

test("aborted requests never open a session", async () => {
  const fake = fakeClient([]);
  await assert.rejects(runAgentTurn({ ...opts, signal: AbortSignal.abort() }, { openai: fake.client }));
  assert.equal(fake.order.length, 0);
});
