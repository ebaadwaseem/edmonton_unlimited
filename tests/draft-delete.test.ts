import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { PDFDocument } from "pdf-lib";
import { db } from "../backend/db.ts";
import { deleteApplicationDraft } from "../backend/routes/applications.ts";
import { createApp } from "../backend/app.ts";
function recorder() {
  let status = 200; let body: any;
  const response = { locals: { principal: { id: "demo-applicant", role: "applicant" } },status(code: number) { status=code; return response; },json(value: unknown) { body=value; return response; } } as unknown as Response;
  return { response,status: () => status,body: () => body };
}
function mockDatabase(t: any, application: object | null, locked = true) {
  const operations: string[] = []; let released = false;
  const client = { async query(sql: string,params: unknown[]) {
    operations.push(sql);
    if (sql.includes("pg_try_advisory")) return { rows: [{ locked }] };
    if (sql.includes("FROM applications a")) { assert.deepEqual(params,[7,"demo-applicant"]); assert.match(sql,/a.owner_id=\$2/); return { rows: application ? [application] : [] }; }
    if (sql.startsWith("DELETE")) assert.deepEqual(params,[7,"demo-applicant"]);
    return { rows: [] };
  },release() { released=true; } };
  t.mock.method(db,"connect",async () => client);
  return { operations,released: () => released };
}
const request = { params: { id: "7" } } as unknown as Request;
test("deleting an owned unsubmitted draft commits atomically and releases its connection",async (t) => {
  const state = mockDatabase(t,{ id:"7",workflow_status:"draft",latest_submission_id:null,has_submissions:false });
  const recorded = recorder(); await deleteApplicationDraft(request,recorded.response);
  assert.equal(recorded.status(),200); assert.deepEqual(recorded.body(),{ id:"7",deleted:true });
  assert.ok(state.operations.some((sql) => sql.startsWith("DELETE FROM applications")));
  assert.equal(state.operations.at(-1),"COMMIT"); assert.ok(state.released());
});
for (const application of [
  { workflow_status:"submitted",latest_submission_id:"1",has_submissions:true },
  { workflow_status:"changes_requested",latest_submission_id:"1",has_submissions:true },
  { workflow_status:"review_complete",latest_submission_id:"1",has_submissions:true },
  { workflow_status:"draft",latest_submission_id:null,has_submissions:true },
]) test(`deletion preserves submission history (${application.workflow_status}, history=${application.has_submissions})`,async (t) => {
  const state=mockDatabase(t,application); const recorded=recorder(); await deleteApplicationDraft(request,recorded.response);
  assert.equal(recorded.status(),409); assert.ok(!state.operations.some((sql) => sql.startsWith("DELETE"))); assert.equal(state.operations.at(-1),"ROLLBACK");
});
test("another owner's or nonexistent draft is not deleted",async (t) => {
  const state=mockDatabase(t,null);const recorded=recorder();await deleteApplicationDraft(request,recorded.response);
  assert.equal(recorded.status(),404); assert.ok(!state.operations.some((sql) => sql.startsWith("DELETE")));
});
test("an active agent turn blocks draft deletion",async (t) => {
  const state=mockDatabase(t,{ workflow_status:"draft" },false);const recorded=recorder();await deleteApplicationDraft(request,recorded.response);
  assert.equal(recorded.status(),409);assert.ok(!state.operations.some((sql) => sql.startsWith("DELETE"))); assert.ok(state.released());
});
test("invalid deletion IDs do not acquire a database connection",async (t) => {
  const connect=t.mock.method(db,"connect",async () => { throw new Error("Unexpected connection"); });
  const recorded=recorder();await deleteApplicationDraft({ params:{ id:"invalid" } } as unknown as Request,recorded.response);
  assert.equal(recorded.status(),400);assert.equal(connect.mock.callCount(),0);
});

test("live draft deletion removes only an owned draft and its children, preserving submitted demo records",{ skip:process.env.REVIEW_INTEGRATION !== "1" },async (t) => {
  const server=createApp({ access:{ applicantPasscode:"1234",reviewerPasscode:"5678" } }).listen(0,"127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening",resolve));
  t.after(async () => { server.closeIdleConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await db.end(); });
  const address=server.address();if (!address || typeof address === "string") throw new Error("No listener");const base=`http://127.0.0.1:${address.port}`;
  async function login(role:string,passcode:string) { const response=await fetch(base+"/api/auth/login",{ method:"POST",headers:{ "Content-Type":"application/json" },body:JSON.stringify({ role,passcode }) });assert.equal(response.status,200);return response.headers.get("set-cookie")!.split(";")[0]; }
  const applicant=await login("applicant","1234"),reviewer=await login("reviewer","5678");
  const created=await fetch(base+"/api/applications",{ method:"POST",headers:{ cookie:applicant,"Content-Type":"application/json" },body:JSON.stringify({ title:"[Fictional deletion test] Disposable draft",jurisdiction:"Alberta" }) });
  assert.equal(created.status,201);const draft=await created.json() as { id:string };
  const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save();const body=new FormData();body.append("file",new Blob([bytes],{ type:"application/pdf" }),"disposable-draft.pdf");
  assert.equal((await fetch(`${base}/api/applications/${draft.id}/documents`,{ method:"POST",headers:{ cookie:applicant },body })).status,201);
  await db.query("INSERT INTO conversation_messages (application_id,role,content) VALUES ($1,'user','Fictional disposable draft test')",[draft.id]);
  await db.query("INSERT INTO form_suggestions (application_id,field_key,suggested_value,explanation) VALUES ($1,'applicant.ownerName','Fictional test','Disposable draft fixture')",[draft.id]);
  assert.equal((await fetch(`${base}/api/applications/${draft.id}`,{ method:"DELETE",headers:{ cookie:reviewer } })).status,403);
  const lock=await db.connect();
  try {
    await lock.query("SELECT pg_advisory_lock($1::bigint)",[draft.id]);
    assert.equal((await fetch(`${base}/api/applications/${draft.id}`,{ method:"DELETE",headers:{ cookie:applicant } })).status,409);
  } finally { await lock.query("SELECT pg_advisory_unlock($1::bigint)",[draft.id]);lock.release(); }
  assert.equal((await fetch(`${base}/api/applications/${draft.id}`,{ method:"DELETE",headers:{ cookie:applicant } })).status,200);
  assert.equal((await fetch(`${base}/api/applications/${draft.id}`,{ headers:{ cookie:applicant } })).status,404);
  for (const table of ["applications","application_documents","conversation_messages","form_suggestions"]) {
    const rows=await db.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${table === "applications" ? "id" : "application_id"}=$1`,[draft.id]);assert.equal(rows.rows[0].count,0);
  }
  const submitted=(await db.query("SELECT id,latest_submission_id FROM applications WHERE owner_id='demo-applicant' AND latest_submission_id IS NOT NULL AND title LIKE '[Fictional demo]%' LIMIT 1")).rows[0];
  if (submitted) {
    const notesBefore=(await db.query("SELECT count(*)::int AS count FROM submission_review_events WHERE submission_id=$1",[submitted.latest_submission_id])).rows[0].count;
    assert.equal((await fetch(`${base}/api/applications/${submitted.id}`,{ method:"DELETE",headers:{ cookie:applicant } })).status,409);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM submission_review_events WHERE submission_id=$1",[submitted.latest_submission_id])).rows[0].count,notesBefore);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM application_submissions WHERE id=$1",[submitted.latest_submission_id])).rows[0].count,1);
  }
});
