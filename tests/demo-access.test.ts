import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../backend/app.ts";
import { db } from "../backend/db.ts";
const access = { applicantPasscode: "1234", reviewerPasscode: "5678" };
function persistentSessions(t: any) {
  const sessions = new Map<string,Record<string,unknown>>();
  const query = t.mock.method(db,"query",async (sql: string,params: any[] = []) => {
    if (sql.includes("INSERT INTO demo_sessions")) {
      sessions.delete(params[0]);
      sessions.set(params[1],{ principal_id:params[2],role:params[3],credential_fingerprint:params[4] });
      return { rows:[] };
    }
    if (sql.startsWith("SELECT principal_id")) return { rows:sessions.has(params[0]) ? [sessions.get(params[0])] : [] };
    if (sql.startsWith("DELETE FROM demo_sessions")) { sessions.delete(params[0]);return { rows:[] }; }
    return { rows:[{ owner_id:"another-owner" }] };
  });
  return { sessions,query };
}
test("demo login enforces cookies, role boundaries, owner checks and logout revocation", async (t) => {
  const server = createApp({ access }).listen(0,"127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening",resolve));
  t.after(async () => { server.closeIdleConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No test listener");
  const base = `http://127.0.0.1:${address.port}`;
  const { query } = persistentSessions(t);
  assert.equal((await fetch(`${base}/api/reference-documents/5/pdf`)).status,401);
  assert.equal((await fetch(`${base}/api/reviewer/queue`)).status,401);
  assert.equal((await fetch(`${base}/API/Applications/99`)).status,401);
  assert.equal(query.mock.callCount(),0);
  const wrong = await fetch(`${base}/api/auth/login`,{ method: "POST",headers: { "Content-Type":"application/json" },body: JSON.stringify({ role:"reviewer",passcode:access.applicantPasscode }) });
  assert.equal(wrong.status,401);
  const login = await fetch(`${base}/api/auth/login`,{ method: "POST",headers: { "Content-Type":"application/json" },body: JSON.stringify({ role:"applicant",passcode:access.applicantPasscode }) });
  assert.equal(login.status,200);
  const setCookie = login.headers.get("set-cookie")!; assert.match(setCookie,/HttpOnly/); assert.match(setCookie,/SameSite=Strict/);
  const cookie = setCookie.split(";")[0]; const headers = { cookie };
  assert.equal((await fetch(`${base}/api/reviewer/queue`,{ headers })).status,403);
  assert.equal((await fetch(`${base}/API/ReVieWer/queue`,{ headers })).status,403);
  assert.equal((await fetch(`${base}/api/applications/99/documents/1/pdf`,{ headers })).status,404);
  assert.equal((await fetch(`${base}/api/submissions/99/preview.pdf`,{ headers })).status,404);
  assert.equal((await fetch(`${base}/api/applications`,{ method:"POST",headers:{ ...headers,Origin:"https://example.invalid","Content-Type":"application/json" },body: "{}" })).status,403);
  const reviewer = await fetch(`${base}/api/auth/login`,{ method:"POST",headers:{ ...headers,"Content-Type":"application/json" },body:JSON.stringify({ role:"reviewer",passcode:access.reviewerPasscode }) });
  const reviewerCookie = reviewer.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await fetch(`${base}/api/auth/session`,{ headers })).status,200);
  assert.equal((await (await fetch(`${base}/api/auth/session`,{ headers })).json() as { principal: unknown }).principal,null,"switching roles revokes the old session");
  assert.equal((await fetch(`${base}/api/applications/1`,{ headers:{ cookie:reviewerCookie } })).status,403);
  assert.equal((await fetch(`${base}/api/auth/logout`,{ method:"POST",headers:{ cookie:reviewerCookie } })).status,200);
  assert.equal((await fetch(`${base}/api/reviewer/queue`,{ headers:{ cookie:reviewerCookie } })).status,401);
});
test("demo access rejects empty or identical role passcodes", async () => {
  assert.throws(() => createApp({ access:{ applicantPasscode:"",reviewerPasscode:"5678" } }),/distinct, nonempty/);
  assert.throws(() => createApp({ access:{ applicantPasscode:"1234",reviewerPasscode:"1234" } }),/distinct, nonempty/);
});

test("durable demo login survives more than eight hours and a fresh backend instance",async (t) => {
  const { sessions } = persistentSessions(t);
  async function launch() {
    const server=createApp({ access }).listen(0,"127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening",resolve));
    const stop=async () => { server.closeIdleConnections();await new Promise<void>((resolve) => server.close(() => resolve())); };
    t.after(stop);
    const address=server.address();if (!address || typeof address === "string") throw new Error("No listener");
    return { base:`http://127.0.0.1:${address.port}`,stop };
  }
  const first=await launch();
  const login=await fetch(first.base+"/api/auth/login",{ method:"POST",headers:{ "Content-Type":"application/json" },body:JSON.stringify({ role:"applicant",passcode:"1234" }) });
  assert.equal(login.status,200);
  const header=login.headers.get("set-cookie")!;
  assert.ok(Number(/Max-Age=(\d+)/.exec(header)![1]) > 8*60*60);
  const cookie=header.split(";")[0];assert.equal(sessions.size,1);
  await first.stop();
  const later=Date.now()+9*60*60*1000;t.mock.method(Date,"now",()=>later);
  const second=await launch();
  const response=await fetch(second.base+"/api/auth/session",{ headers:{ cookie } });
  assert.equal((await response.json() as { principal:{ role:string } }).principal.role,"applicant");
  assert.match(response.headers.get("set-cookie")!,/Max-Age=34560000/);
  const different=createApp({ access:{ ...access,applicantPasscode:"changed" } }).listen(0,"127.0.0.1");
  await new Promise<void>((resolve) => different.once("listening",resolve));
  t.after(async () => { different.closeIdleConnections();await new Promise<void>((resolve) => different.close(() => resolve())); });
  const address=different.address();if (!address || typeof address === "string") throw new Error("No listener");
  const invalid=await fetch(`http://127.0.0.1:${address.port}/api/auth/session`,{ headers:{ cookie } });
  assert.equal((await invalid.json() as { principal:unknown }).principal,null,"changing the role password invalidates its saved sessions");
  await fetch(second.base+"/api/auth/logout",{ method:"POST",headers:{ cookie } });
  assert.equal(sessions.size,0);
});
