import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { getApplicationDocument } from "../backend/routes/documents.ts";
import { db } from "../backend/db.ts";

function responseRecorder() {
  let status = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  const response = {
    status(code: number) { status = code; return response; },
    json(value: unknown) { body = value; return response; },
    send(value: unknown) { body = value; return response; },
    setHeader(name: string, value: string) { headers.set(name, value); return response; },
  } as unknown as Response;
  return { response, headers, status: () => status, body: () => body };
}

test("document preview returns PDF bytes using both application and document IDs", async (t) => {
  const pdf = Buffer.from("%PDF-1.7\npreview fixture");
  const query = t.mock.method(db, "query", async (_sql: string, params?: unknown[]) => {
    assert.deepEqual(params, [41, 10]);
    return { rows: [{ file_bytes: pdf }], rowCount: 1 };
  });
  const recorded = responseRecorder();
  await getApplicationDocument({ params: { id: "10", documentId: "41" } } as unknown as Request, recorded.response);
  assert.equal(query.mock.callCount(), 1);
  assert.equal(recorded.status(), 200);
  assert.equal(recorded.body(), pdf);
  assert.equal(recorded.headers.get("Content-Type"), "application/pdf");
  assert.equal(recorded.headers.get("Cache-Control"), "private, no-store");
  assert.equal(recorded.headers.get("X-Content-Type-Options"), "nosniff");
});

test("a document outside the requested application returns 404 without bytes", async (t) => {
  t.mock.method(db, "query", async (_sql: string, params?: unknown[]) => {
    assert.deepEqual(params, [41, 99]);
    return { rows: [], rowCount: 0 };
  });
  const recorded = responseRecorder();
  await getApplicationDocument({ params: { id: "99", documentId: "41" } } as unknown as Request, recorded.response);
  assert.equal(recorded.status(), 404);
  assert.deepEqual(recorded.body(), { error: "Document not found in this application." });
  assert.equal(recorded.headers.has("Content-Type"), false);
});

test("invalid preview IDs are rejected before touching the database", async (t) => {
  const query = t.mock.method(db, "query", async () => { throw new Error("Unexpected database access"); });
  for (const params of [{ id: "invalid", documentId: "41" }, { id: "10", documentId: "-1" }, { id: "10", documentId: "9007199254740992" }]) {
    const recorded = responseRecorder();
    await getApplicationDocument({ params } as unknown as Request, recorded.response);
    assert.equal(recorded.status(), 400);
  }
  assert.equal(query.mock.callCount(), 0);
});
