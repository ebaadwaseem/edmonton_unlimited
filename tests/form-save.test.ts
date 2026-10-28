import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { saveApplicationForm } from "../backend/routes/applications.ts";
import { db } from "../backend/db.ts";

function responseRecorder() {
  let status = 200;
  let body: any;
  const response = { status(code: number) { status = code; return response; }, json(value: unknown) { body = value; return response; } } as unknown as Response;
  return { response, status: () => status, body: () => body };
}
function database(t: any, current: object) {
  const operations: string[] = [];
  let written: any;
  let released = false;
  const client = {
    async query(sql: string, params?: unknown[]) {
      operations.push(sql);
      if (sql.startsWith("SELECT")) return { rows: [{ form_data: current }], rowCount: 1 };
      if (sql.startsWith("UPDATE")) { written = JSON.parse(String(params![0])); return { rows: [{ id: "7", form_data: written }], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; },
  };
  t.mock.method(db, "connect", async () => client);
  return { operations, written: () => written, released: () => released };
}

test("manual saves commit a typed checkbox/date draft and retain prior professional-screening evidence", async (t) => {
  const current = { sectionD: { document1: "Plan" }, sectionDEvidence: { 1: { engineeringAssessment: "potential_engineering", status: "recommended" } } };
  const state = database(t, current);
  const recorded = responseRecorder();
  await saveApplicationForm({ params: { id: "7" }, body: { formData: { ...current, applicant: { requestDate: "2026-10-28" }, project: { sccSubmitted: true }, sectionD: { document1: "Plan", responsible1: "Named by user" } } } } as unknown as Request, recorded.response);
  assert.equal(recorded.status(), 200);
  assert.equal(state.written().project.sccSubmitted, true);
  assert.equal(state.written().sectionDEvidence[1].engineeringAssessment, "potential_engineering");
  assert.equal(state.operations.at(-1), "COMMIT");
  assert.ok(state.released());
});

test("PDF overflow rolls back the draft before any update", async (t) => {
  const state = database(t, { applicant: { ownerName: "Saved owner" } });
  const recorded = responseRecorder();
  await saveApplicationForm({ params: { id: "7" }, body: { formData: { sectionC: { intent1: "Too much text for a single template cell. ".repeat(100) } } } } as unknown as Request, recorded.response);
  assert.equal(recorded.status(), 422);
  assert.match(recorded.body().error, /exceeds this template cell/);
  assert.equal(state.written(), undefined);
  assert.equal(state.operations.at(-1), "ROLLBACK");
  assert.ok(state.released());
});
