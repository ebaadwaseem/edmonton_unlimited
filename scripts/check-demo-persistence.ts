import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../backend/db.ts";
const queries: Record<string,string> = {
  applications:"SELECT * FROM applications ORDER BY id",
  uploads:"SELECT id,application_id,original_filename,page_count,uploaded_at,encode(sha256(file_bytes),'hex') AS sha256 FROM application_documents ORDER BY id",
  messages:"SELECT * FROM conversation_messages ORDER BY id",
  suggestions:"SELECT * FROM form_suggestions ORDER BY id",
  submissions:"SELECT id,application_id,revision,snapshot,submitted_by,submitted_at,status,status_updated_by,status_updated_at,encode(sha256(preview_bytes),'hex') AS sha256 FROM application_submissions ORDER BY id",
  submittedUploads:"SELECT id,submission_id,original_document_id,original_filename,page_count,uploaded_at,encode(sha256(file_bytes),'hex') AS sha256 FROM submission_documents ORDER BY id",
  submittedReferences:"SELECT submission_id,original_document_id,title,edition,jurisdiction,page_count,sha256,encode(sha256(file_bytes),'hex') AS actual_sha256 FROM submission_references ORDER BY submission_id,original_document_id",
  findings:"SELECT * FROM submission_findings ORDER BY id",
  reviewEvents:"SELECT * FROM submission_review_events ORDER BY id",
  sessions:"SELECT * FROM demo_sessions ORDER BY token_hash",
  sourceDocuments:"SELECT id,title,edition,jurisdiction,reference_role,page_count,encode(sha256(file_bytes),'hex') AS sha256 FROM documents ORDER BY id",
  provisions:"SELECT * FROM code_provisions ORDER BY id",
  attributions:"SELECT * FROM provision_attributions ORDER BY id",
};
const base = process.env.DEMO_TEST_BASE_URL ?? "http://127.0.0.1:3001";
const mode=process.argv[2], path=process.argv[3];
async function rowsManifest() {
  const manifest:Record<string,{ count:number;sha256:string }> = {};
  for(const [name,sql] of Object.entries(queries)) {
    const { rows }=await db.query(sql);
    manifest[name]={ count:rows.length,sha256:createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
  }
  return manifest;
}
async function api(path:string,cookie:string) {
  const response=await fetch(base+path,{ headers:{ cookie } });
  if (!response.ok) throw new Error(`Persistence check ${path}: HTTP ${response.status}`);
  return response.json();
}
try {
  if(!path || !["capture","verify"].includes(mode)) throw new Error("Usage: node --import tsx scripts/check-demo-persistence.ts <capture|verify> <private-manifest.json>");
  if(mode==="capture") {
    const active=(await db.query("SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND granted")).rows[0].count;
    if(active) throw new Error("An advisory lock is active. Wait for assistant requests/migrations before a restart test.");
    const cookies:Record<string,string>={};
    for(const [role,passcode] of [["applicant","1234"],["reviewer","5678"]]) {
      const response=await fetch(base+"/api/auth/login",{ method:"POST",headers:{ "Content-Type":"application/json" },body:JSON.stringify({ role,passcode }) });
      if(!response.ok) throw new Error(`Could not sign in as ${role}: HTTP ${response.status}`);
      cookies[role]=response.headers.get("set-cookie")!.split(";")[0];
    }
    const applicantList=await api("/api/applications",cookies.applicant);
    const reviewerQueue=await api("/api/reviewer/queue",cookies.reviewer);
    const manifest=await rowsManifest();
    await writeFile(path,JSON.stringify({ manifest,cookies,applicantList,reviewerQueue }),{ mode:0o600 });
    console.log(JSON.stringify({ captured:true,counts:Object.fromEntries(Object.entries(manifest).map(([key,value])=>[key,value.count])) }));
  }else {
    const before=JSON.parse(await readFile(path,"utf8"));
    for(const role of ["applicant","reviewer"]) {
      const session=await api("/api/auth/session",before.cookies[role]) as { principal?:{ role:string } };
      if(session.principal?.role!==role) throw new Error(`${role} login did not survive the restart.`);
    }
    if(JSON.stringify(await api("/api/applications",before.cookies.applicant))!==JSON.stringify(before.applicantList)) throw new Error("Applicant applications changed after restart.");
    if(JSON.stringify(await api("/api/reviewer/queue",before.cookies.reviewer))!==JSON.stringify(before.reviewerQueue)) throw new Error("Reviewer queue changed after restart.");
    const after=await rowsManifest();
    for(const [name,result] of Object.entries(after)) if(JSON.stringify(result)!==JSON.stringify(before.manifest[name])) throw new Error(`${name}: stored data changed after restart.`);
    console.log(JSON.stringify({ verified:true,durableRoles:["applicant","reviewer"],unchangedTables:Object.keys(after),applicantCount:before.applicantList.length,reviewerQueueCount:before.reviewerQueue.length }));
    // Revoke only this check's temporary sessions and scrub their raw tokens.
    for(const cookie of Object.values(before.cookies) as string[]) await fetch(base+"/api/auth/logout",{ method:"POST",headers:{ cookie } });
    delete before.cookies;
    await writeFile(path,JSON.stringify({ ...before,verified:true }),{ mode:0o600 });
  }
}finally{await db.end();}
