import { Router } from "express";
import { db } from "../db.ts";
import { parseId } from "../http.ts";
import { createPreview, PdfValidationError } from "../template.ts";
import { attributionFingerprint, inspectAttributions, lookupVerifiedAttributions } from "../attributions.ts";
import { buildCompletenessFindings } from "../completeness.ts";
import type { SubmissionSnapshot } from "../../shared/review.ts";
export const router = Router();
class WorkflowError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
router.post("/api/applications/:id/submit", async (request, response) => {
  const id = parseId(request.params.id);
  if (id === null) { response.status(400).json({ error: "Invalid application ID." }); return; }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query("SELECT pg_try_advisory_xact_lock($1::bigint) AS locked", [id]);
    if (!lock.rows[0].locked) throw new WorkflowError(409, "Wait for the active assistant request to finish before submitting.");
    const application = (await client.query("SELECT id,title,jurisdiction,form_data,workflow_status,owner_id FROM applications WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!application || application.owner_id !== response.locals.principal.id) throw new WorkflowError(404, "Application not found.");
    if (application.workflow_status === "submitted") throw new WorkflowError(409, "This application already has a submission awaiting review. Your working draft remains editable.");
    const documents = (await client.query<SubmissionSnapshot["documents"][number]>("SELECT id,original_filename,page_count,uploaded_at,encode(sha256(file_bytes),'hex') AS sha256 FROM application_documents WHERE application_id=$1 ORDER BY id", [id])).rows;
    const suggestions = (await client.query<SubmissionSnapshot["suggestions"][number]>("SELECT id,field_key,suggested_value,explanation,metadata,status,created_at FROM form_suggestions WHERE application_id=$1 ORDER BY id", [id])).rows;
    const messages = (await client.query<NonNullable<SubmissionSnapshot["messages"]>[number]>("SELECT id,role,content,created_at FROM conversation_messages WHERE application_id=$1 ORDER BY id", [id])).rows;
    const form = application.form_data;
    const attributionChecks: SubmissionSnapshot["attributionChecks"] = [];
    const referenceIds = new Set<number>();
    for (let row = 1; row <= 5; row++) {
      const evidence = form.sectionCEvidence?.[row];
      for (const citation of evidence?.citations ?? []) if (positive(Number(citation.documentId))) referenceIds.add(Number(citation.documentId));
      if (!form.sectionC?.[`article${row}`]) continue;
      if (!evidence || !positive(Number(evidence.documentId)) || typeof evidence.articleNumber !== "string") {
        attributionChecks.push({ row, verified: false, blockers: ["No exact source edition/provision/scope evidence is attached. Manual values remain unverified."] }); continue;
      }
      referenceIds.add(Number(evidence.documentId));
      try {
        const report = await inspectAttributions(Number(evidence.documentId), evidence.articleNumber, evidence.scope ?? "");
        const mapping = await lookupVerifiedAttributions(Number(evidence.documentId), evidence.articleNumber, evidence.scope ?? "");
        const verified = Boolean(mapping && evidence.verified === true && attributionFingerprint(mapping) === evidence.mappingFingerprint
          && form.sectionC[`article${row}`] === [mapping.reference, mapping.scope].filter(Boolean).join("\n")
          && form.sectionC[`objective${row}`] === mapping.objective && form.sectionC[`function${row}`] === mapping.function && form.sectionC[`intent${row}`] === mapping.intent
          && form.sectionC.code === [mapping.title,mapping.edition,mapping.jurisdiction].filter(Boolean).join(" · "));
        attributionChecks.push({ row, verified, report, blockers: verified ? [] : report.blockers.length ? report.blockers : ["Saved evidence or form values differ from the currently reviewed mapping. A fresh proposal is needed."] });
      } catch (error) { attributionChecks.push({ row, verified: false, blockers: [error instanceof Error ? error.message : "Attribution source could not be resolved."] }); }
    }
    // The existing Alberta code and national intent supplement are available as
    // frozen reference material, without inferring compatibility or applicability.
    const referenceCandidates = (await client.query<NonNullable<SubmissionSnapshot["referenceCandidates"]>[number]>(`SELECT c.id,p.reference AS target_reference,p.scope AS target_scope,c.kind,c.attribution_group,c.statement_label,c.statement_text,
      c.source_document_id,c.source_reference,c.source_scope,d.title AS source_title,d.edition AS source_edition,c.source_pdf_page_start,c.source_pdf_page_end,c.verification_status,c.compatibility_status
      FROM provision_attributions c JOIN code_provisions p ON p.id=c.provision_id JOIN documents d ON d.id=c.source_document_id
      WHERE p.document_id IN (SELECT id FROM documents WHERE reference_role='code') OR p.document_id=ANY($1::bigint[]) ORDER BY p.reference,c.id`,[[...referenceIds]])).rows;
    for (const candidate of referenceCandidates) referenceIds.add(Number(candidate.source_document_id));
    const references = (await client.query<SubmissionSnapshot["references"][number]>("SELECT id,title,edition,jurisdiction,page_count,encode(sha256(file_bytes),'hex') AS sha256 FROM documents WHERE reference_role IN ('code','intent_supplement') OR id=ANY($1::bigint[]) ORDER BY id", [[...referenceIds]])).rows;
    const snapshot: SubmissionSnapshot = { application: { id: application.id, title: application.title, jurisdiction: application.jurisdiction, form_data: form }, documents, suggestions, attributionChecks, references, messages, referenceCandidates };
    const bytes = await createPreview(form);
    const submission = (await client.query(`INSERT INTO application_submissions (application_id,revision,snapshot,preview_bytes,submitted_by)
      SELECT $1,COALESCE(MAX(revision),0)+1,$2::jsonb,$3,$4 FROM application_submissions WHERE application_id=$1 RETURNING id,revision,status,submitted_at`, [id,JSON.stringify(snapshot),Buffer.from(bytes),response.locals.principal.id])).rows[0];
    await client.query(`INSERT INTO submission_documents (submission_id,original_document_id,original_filename,page_count,uploaded_at,file_bytes)
      SELECT $1,id,original_filename,page_count,uploaded_at,file_bytes FROM application_documents WHERE application_id=$2`, [submission.id,id]);
    await client.query(`INSERT INTO submission_references (submission_id,original_document_id,title,edition,jurisdiction,page_count,sha256,file_bytes)
      SELECT $1,id,title,edition,jurisdiction,page_count,encode(sha256(file_bytes),'hex'),file_bytes FROM documents WHERE id=ANY($2::bigint[])`, [submission.id,references.map((r) => r.id)]);
    for (const finding of buildCompletenessFindings(snapshot)) await client.query("INSERT INTO submission_findings (submission_id,finding_key,section,title,status,detail) VALUES ($1,$2,$3,$4,$5,$6)", [submission.id,finding.key,finding.section,finding.title,finding.status,finding.detail]);
    await client.query("UPDATE applications SET workflow_status='submitted',latest_submission_id=$1 WHERE id=$2", [submission.id,id]);
    await client.query("COMMIT"); response.status(201).json(submission);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof WorkflowError || error instanceof PdfValidationError) response.status(error instanceof WorkflowError ? error.status : 422).json({ error: error.message });
    else throw error;
  } finally { client.release(); }
});
router.get("/api/reviewer/queue", async (_request, response) => {
  response.json((await db.query(`SELECT s.id,s.application_id,s.revision,s.submitted_at,s.status,s.status_updated_at,
    s.snapshot->'application'->>'title' AS title,s.snapshot->'application'->>'jurisdiction' AS jurisdiction,
    s.snapshot->'application'->'form_data'->'applicant'->>'ownerName' AS applicant,
    count(f.id)::int AS finding_count,count(f.id) FILTER (WHERE f.review_status='unreviewed')::int AS unreviewed_count,
    count(f.id) FILTER (WHERE f.status IN ('missing','needs_clarification','unverified'))::int AS flagged_count
    FROM application_submissions s JOIN applications a ON a.latest_submission_id=s.id
    LEFT JOIN submission_findings f ON f.submission_id=s.id GROUP BY s.id ORDER BY s.submitted_at DESC,s.id DESC`)).rows);
});
router.get("/api/submissions/:id", async (request, response) => {
  const result = await db.query("SELECT s.id,s.application_id,s.revision,s.snapshot,s.submitted_at,s.status,s.status_updated_by,s.status_updated_at,a.latest_submission_id=s.id AS is_latest FROM application_submissions s JOIN applications a ON a.id=s.application_id WHERE s.id=$1", [request.params.id]);
  if (!result.rows.length) { response.status(404).json({ error: "Submission not found." }); return; }
  const submission = result.rows[0];
  const [findings,events,history] = await Promise.all([
    db.query("SELECT * FROM submission_findings WHERE submission_id=$1 ORDER BY id", [submission.id]),
    db.query("SELECT * FROM submission_review_events WHERE submission_id=$1 ORDER BY id", [submission.id]),
    db.query("SELECT id,revision,status,submitted_at FROM application_submissions WHERE application_id=$1 ORDER BY revision DESC", [submission.application_id]),
  ]);
  response.json({ ...submission,findings: findings.rows.map((finding) => ({ ...finding, key: finding.finding_key })),events: events.rows,history: history.rows });
});
function sendPdf(response: import("express").Response, bytes: Buffer, filename: string) {
  response.setHeader("Content-Type","application/pdf"); response.setHeader("Content-Disposition",`inline; filename="${filename}"`);
  response.setHeader("Cache-Control","private, no-store"); response.setHeader("X-Content-Type-Options","nosniff"); response.send(bytes);
}
router.get("/api/submissions/:id/preview.pdf", async (request,response) => {
  const row = (await db.query("SELECT preview_bytes FROM application_submissions WHERE id=$1",[request.params.id])).rows[0];
  if (!row) { response.status(404).json({ error: "Submission not found." }); return; }
  sendPdf(response,row.preview_bytes,`submission-${request.params.id}.pdf`);
});
router.get("/api/submissions/:id/documents/:documentId/pdf", async (request,response) => {
  const documentId = parseId(request.params.documentId);
  if (documentId === null) { response.status(400).json({ error: "Invalid document ID." }); return; }
  const row = (await db.query("SELECT file_bytes FROM submission_documents WHERE submission_id=$1 AND original_document_id=$2",[request.params.id,documentId])).rows[0];
  if (!row) { response.status(404).json({ error: "Document is not in this submission." }); return; }
  sendPdf(response,row.file_bytes,`submitted-document-${documentId}.pdf`);
});
router.get("/api/submissions/:id/references/:documentId/pdf", async (request,response) => {
  const documentId = parseId(request.params.documentId);
  if (documentId === null) { response.status(400).json({ error: "Invalid reference ID." }); return; }
  const row = (await db.query("SELECT file_bytes FROM submission_references WHERE submission_id=$1 AND original_document_id=$2",[request.params.id,documentId])).rows[0];
  if (!row) { response.status(404).json({ error: "Reference is not in this submission." }); return; }
  sendPdf(response,row.file_bytes,`submitted-reference-${documentId}.pdf`);
});

router.post("/api/reviewer/submissions/:id/findings/:findingId", async (request,response) => {
  const id = parseId(request.params.id), findingId = parseId(request.params.findingId);
  const { reviewStatus, note = "" } = request.body ?? {};
  if (id === null || findingId === null || typeof note !== "string" || note.length > 5000 || reviewStatus !== undefined && !["reviewed","needs_clarification"].includes(reviewStatus) || !reviewStatus && !note.trim() || reviewStatus === "needs_clarification" && !note.trim()) {
    response.status(400).json({ error: "Provide a valid review action and a note for clarification (up to 5000 characters)." }); return;
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const submission = (await client.query("SELECT s.*,a.latest_submission_id FROM application_submissions s JOIN applications a ON a.id=s.application_id WHERE s.id=$1 FOR UPDATE OF s",[id])).rows[0];
    if (!submission) throw new WorkflowError(404,"Submission not found.");
    if (String(submission.latest_submission_id) !== String(id) || submission.status !== "submitted") throw new WorkflowError(409,"This revision is closed or superseded. Review the latest submitted revision.");
    const finding = (await client.query("SELECT id FROM submission_findings WHERE id=$1 AND submission_id=$2 FOR UPDATE",[findingId,id])).rows[0];
    if (!finding) throw new WorkflowError(404,"Finding is not in this submission.");
    if (reviewStatus) await client.query("UPDATE submission_findings SET review_status=$1,reviewed_by=$2,updated_at=NOW() WHERE id=$3",[reviewStatus,response.locals.principal.id,findingId]);
    await client.query("INSERT INTO submission_review_events (submission_id,finding_id,actor_id,action,note) VALUES ($1,$2,$3,$4,$5)",[id,findingId,response.locals.principal.id,reviewStatus ?? "note",note.trim()]);
    await client.query("COMMIT"); response.json({ ok: true });
  } catch (error) { await client.query("ROLLBACK"); if (error instanceof WorkflowError) response.status(error.status).json({ error: error.message }); else throw error; }
  finally { client.release(); }
});
router.post("/api/reviewer/submissions/:id/status", async (request,response) => {
  const id = parseId(request.params.id);
  const { status, note } = request.body ?? {};
  if (id === null || !["changes_requested","review_complete"].includes(status) || typeof note !== "string" || !note.trim() || note.length > 5000) { response.status(400).json({ error: "Select an internal review status and provide a note (up to 5000 characters)." }); return; }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const application = (await client.query("SELECT a.id,a.latest_submission_id FROM applications a JOIN application_submissions s ON s.application_id=a.id WHERE s.id=$1 FOR UPDATE OF a",[id])).rows[0];
    const submission = (await client.query("SELECT status FROM application_submissions WHERE id=$1 FOR UPDATE",[id])).rows[0];
    if (!application || !submission) throw new WorkflowError(404,"Submission not found.");
    if (String(application.latest_submission_id) !== String(id) || submission.status !== "submitted") throw new WorkflowError(409,"This revision is closed or superseded.");
    if (status === "review_complete") {
      const remaining = await client.query("SELECT count(*)::int AS count FROM submission_findings WHERE submission_id=$1 AND review_status <> 'reviewed'",[id]);
      if (remaining.rows[0].count) throw new WorkflowError(409,"Assess each finding first. Clarification findings must be resolved or changes requested. Review complete records administrative review only.");
    }
    await client.query("UPDATE application_submissions SET status=$1,status_updated_by=$2,status_updated_at=NOW() WHERE id=$3",[status,response.locals.principal.id,id]);
    await client.query("UPDATE applications SET workflow_status=$1 WHERE id=$2",[status,application.id]);
    await client.query("INSERT INTO submission_review_events (submission_id,actor_id,action,note) VALUES ($1,$2,$3,$4)",[id,response.locals.principal.id,status,note.trim()]);
    await client.query("COMMIT"); response.json({ ok: true,status });
  } catch (error) { await client.query("ROLLBACK"); if (error instanceof WorkflowError) response.status(error.status).json({ error: error.message }); else throw error; }
  finally { client.release(); }
});
