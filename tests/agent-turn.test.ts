import assert from "node:assert/strict";
import { test } from "node:test";
import type OpenAI from "openai";
import { runAgentTurn } from "../backend/agent/run-turn.ts";

type Event = Record<string, unknown>;
function fakeClient(events: Event[], status = "idle", recovery: { streams?: Event[][]; turns?: any[]; turn?: any; items?: any[]; actions?: any[]; streamError?: Error } = {}) {
  const sent: Array<{ id: string; body: any }> = [];
  const order: string[] = [];
  const creations: any[] = [];
  const controller = new AbortController();
  const stream = {
    controller,
    async *[Symbol.asyncIterator]() { yield* events; if (recovery.streamError) throw recovery.streamError; },
  };
  let opened = false;
  const controllers = [controller];
  const client = {
    beta: { agents: { sessions: {
      retrieve: async (id: string) => ({ id, status, required_actions: recovery.actions ?? [] }),
      create: async (body: unknown) => { opened = true; creations.push(body); order.push("create"); return stream; },
      turns: {
        list: async () => ({ data: recovery.turns ?? [] }),
        retrieve: async () => recovery.turn ?? { status: "in_progress" },
        items: { list: async function* () { yield* recovery.items ?? []; } },
      },
      events: {
        stream: async () => {
          order.push("subscribe");
          if (!opened) { opened = true; return stream; }
          const controller = new AbortController();
          controllers.push(controller);
          const events = recovery.streams?.shift() ?? [];
          return { controller, async *[Symbol.asyncIterator]() { yield* events; } };
        },
        create: async (id: string, body: unknown) => { order.push("send"); sent.push({ id, body }); },
      },
    } } },
  } as unknown as OpenAI;
  return { client, sent, order, controller, controllers, creations };
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

test("repeated stream closure preserves the session and cancels only after bounded recovery", async () => {
  const fake = fakeClient([created]);
  const saved: string[] = [];
  await assert.rejects(runAgentTurn(opts, { openai: fake.client, saveSession: async (id) => { saved.push(id); } }), /repeatedly disconnected/);
  assert.deepEqual(saved, ["session-test"]);
  assert.equal(fake.sent[0].body.events[0].type, "agent.session.input.cancel");
  assert.ok(fake.controller.signal.aborted);
  assert.equal(fake.order.filter((step) => step === "subscribe").length, 3);
  assert.ok(fake.controllers.every((controller) => controller.signal.aborted));
});

const rootTurn = { id: "turn-current", subagent_id: null };
const turnCreated = { type: "agent.session.turn.created", turn: rootTurn };
function savedAnswer(text: string, phase = "final_answer") {
  return { id: "answer-current", type: "message", role: "assistant", status: "completed", phase, turn_id: rootTurn.id, content: [{ type: "output_text", text }] };
}

test("a disconnected completed turn restores its saved final answer without cancellation or resending input", async () => {
  const fake = fakeClient([created, turnCreated, { type: "agent.session.turn.output_text.delta", ...output, delta: "Partial" }], "idle", {
    turn: { ...rootTurn, status: "completed" },
    items: [savedAnswer("Working…", "commentary"), savedAnswer("Recovered final answer")],
  });
  const result = await runAgentTurn(opts, { openai: fake.client, saveSession: async () => undefined });
  assert.equal(result.answer, "Recovered final answer");
  assert.equal(fake.sent.length, 0);
  assert.ok(fake.controllers.every((controller) => controller.signal.aborted));
});

test("a transport error reconnects the current turn without executing a tool twice", async () => {
  const action = { type: "function_call", name: "search_code", arguments: "{}", call_id: "call-1", turn_id: rootTurn.id };
  const required = { type: "agent.session.requires_action", session: { id: "session-test", required_actions: [action] } };
  const fake = fakeClient([created, turnCreated, required], "requires_action", {
    streamError: new TypeError("terminated"),
    turn: { ...rootTurn, status: "waiting" }, actions: [action],
    items: [savedAnswer("Recovered live answer")],
    streams: [[required, { type: "agent.session.turn.output_text.done", ...output, text: "Recovered live answer" }, { ...done, turn: rootTurn }]],
  });
  let calls = 0;
  const result = await runAgentTurn(opts, { openai: fake.client, saveSession: async () => undefined, executeTool: async () => { calls++; return "result"; } });
  assert.equal(result.answer, "Recovered live answer");
  assert.equal(calls, 1);
  assert.equal(fake.sent.length, 1);
  assert.equal(fake.sent[0].body.events[0].type, "agent.session.input.tool_result");
});

test("resumed-turn recovery cannot return the preceding turn's answer", async () => {
  const previous = { id: "previous-turn", subagent_id: null, status: "completed" };
  const fake = fakeClient([], "idle", {
    turns: [previous],
    items: [savedAnswer("New answer")],
    streams: [[turnCreated, { type: "agent.session.turn.output_text.done", ...output, text: "New answer" }, { ...done, turn: rootTurn }]],
  });
  const result = await runAgentTurn({ ...opts, sessionId: "saved-session" }, { openai: fake.client });
  assert.equal(result.answer, "New answer");
  assert.equal(fake.sent.length, 1);
});

test("a failed saved turn reports its real error and is not cancelled or retried", async () => {
  const fake = fakeClient([created, turnCreated], "idle", { turn: { ...rootTurn, status: "failed", error: { message: "Upstream model failure" } } });
  await assert.rejects(runAgentTurn(opts, { openai: fake.client, saveSession: async () => undefined }), /Upstream model failure/);
  assert.equal(fake.sent.length, 0);
});

test("completion racing with recovery cannot return a partial text buffer", async () => {
  const fake = fakeClient([created, turnCreated, { type: "agent.session.turn.output_text.delta", ...output, delta: "Partial" }], "in_progress", {
    turn: { ...rootTurn, status: "in_progress" },
    streams: [[{ ...done, turn: rootTurn }]],
    items: [savedAnswer("Complete answer from saved items")],
  });
  const result = await runAgentTurn(opts, { openai: fake.client, saveSession: async () => undefined });
  assert.equal(result.answer, "Complete answer from saved items");
  assert.equal(fake.sent.length, 0);
});

test("a completed turn missing its text event restores the saved answer", async () => {
  const fake = fakeClient([created, { ...done, turn: rootTurn }], "idle", { items: [savedAnswer("Saved answer")] });
  const result = await runAgentTurn(opts, { openai: fake.client, saveSession: async () => undefined });
  assert.equal(result.answer, "Saved answer");
  assert.equal(fake.sent.length, 0);
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

test("oversized UTF-8 tool output returns a bounded tool error and lets the turn complete", async () => {
  const fake = fakeClient([created, { type: "agent.session.requires_action", session: { id: "session-test", required_actions: [
    { type: "function_call", name: "search_code", arguments: '{"query":"stairs"}', call_id: "large-call", turn_id: "turn-1" },
  ] } }, { type: "agent.session.turn.output_text.done", ...output, text: "Please narrow your request." }, done]);
  // Character count fits the old limit, but serialized UTF-8 bytes do not.
  const large = "📄".repeat(270_000);
  const result = await runAgentTurn(opts, { openai: fake.client, saveSession: async () => undefined, executeTool: async () => large });
  assert.equal(result.answer, "Please narrow your request.");
  const sent = fake.sent[0].body.events[0];
  assert.equal(sent.success, false);
  assert.match(sent.error, /too large/);
  assert.ok(Buffer.byteLength(JSON.stringify(fake.sent[0].body), "utf8") < 1_048_576);
  assert.equal(sent.call_id, "large-call");
});


test("a refreshed agent configuration receives the saved conversation as context", async () => {
  const fake = fakeClient([created, { type: "agent.session.turn.output_text.done", ...output, text: "Ready for Section C" }, done]);
  await runAgentTurn({ ...opts, context: '[{"role":"assistant","content":"Earlier saved answer"}]' }, { openai: fake.client, saveSession: async () => undefined });
  assert.match(fake.creations[0].input, /Earlier saved answer/);
  assert.match(fake.creations[0].input, /Current user message:/);
  assert.match(fake.creations[0].input, /Owner is Jane/);
});
