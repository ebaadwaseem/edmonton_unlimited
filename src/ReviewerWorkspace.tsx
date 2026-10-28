import { lazy, Suspense, useEffect, useState } from "react";
import { FORM_FIELDS, FORM_FIELD_KEYS, readFormField } from "../shared/form-fields";
import { findingLabels, workflowLabels } from "../shared/review";
import type { ReviewedFinding, SubmissionDetail, SubmissionSnapshot, WorkflowStatus } from "../shared/review";
import { api, post } from "./api";
import { readDemoSelection, saveDemoSelection } from "./demo-state";
const VariancePreview = lazy(() => import("./VariancePreview"));
type QueueItem = { id: string; application_id: string; revision: number; title: string; applicant: string; jurisdiction: string; submitted_at: string; status: WorkflowStatus; finding_count: number; unreviewed_count: number; flagged_count: number };
const timestamp = (value: string) => new Date(value).toLocaleString();
function FindingCard({ finding, notes, actionable, busy, onAction }: { finding: ReviewedFinding; notes: SubmissionDetail["events"]; actionable: boolean; busy: boolean; onAction: (id: string, status: string | undefined, note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  async function act(status?: string) { try { await onAction(finding.id,status,note); setNote(""); } catch { /* Parent displays the server error; preserve the note. */ } }
  return <article className="review-finding">
    <div className="review-heading"><h4>{finding.title}</h4><span className={`review-badge review-badge--${finding.status}`}>{findingLabels[finding.status]}</span></div>
    <p>{finding.detail}</p><p className="review-small">Reviewer assessment: <strong>{finding.review_status.replaceAll("_"," ")}</strong>{finding.reviewed_by && ` · ${finding.reviewed_by} · ${timestamp(finding.updated_at)}`}</p>
    {notes.map((entry) => <blockquote key={entry.id}><p>{entry.note || entry.action.replaceAll("_"," ")}</p><footer>{entry.actor_id} · {timestamp(entry.created_at)}</footer></blockquote>)}
    {actionable && <div className="review-finding-actions"><label htmlFor={`finding-note-${finding.id}`}>Reviewer note</label><textarea id={`finding-note-${finding.id}`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={5000} rows={2} disabled={busy} placeholder="Clarify what is missing or what you inspected…" />
      <div className="review-buttons"><button type="button" disabled={busy} onClick={() => void act("reviewed")}>Mark reviewed</button><button type="button" disabled={busy || !note.trim()} onClick={() => void act("needs_clarification")}>Needs clarification</button><button type="button" disabled={busy || !note.trim()} onClick={() => void act()}>Save note</button></div>
    </div>}
  </article>;
}
function FrozenReference({ submissionId, source }: { submissionId: string; source: SubmissionSnapshot["references"][number] }) {
  const [page,setPage] = useState(1);
  return <li><strong>{source.title}</strong><p>{source.edition || "Edition not identified"} · {source.jurisdiction || "Jurisdiction not identified"}</p>
    <div className="review-buttons"><label>Physical PDF page <input type="number" min={1} max={source.page_count} value={page} onChange={(event) => setPage(Math.max(1,Math.min(source.page_count,Number(event.target.value) || 1)))} /></label>
      <a href={`/api/submissions/${submissionId}/references/${source.id}/pdf#page=${page}`} target="_blank" rel="noreferrer">Open frozen original PDF</a></div>
  </li>;
}
function SubmittedSections({ submission }: { submission: SubmissionDetail }) {
  const form = submission.snapshot.application.form_data;
  return <>{(["A","B","C","D"] as const).map((section) => <details className="review-section" key={section} open={section === "C" || section === "D"}>
    <summary>Section {section} · {section === "A" ? "Applicant" : section === "B" ? "Project" : section === "C" ? "Code provisions and attributions" : "Supporting documentation"}</summary>
    <dl className="review-values">{FORM_FIELD_KEYS.filter((key) => FORM_FIELDS[key].section === section).map((key) => {
      const raw = readFormField(form,key); const value = typeof raw === "boolean" ? raw ? "Selected" : "Not selected" : typeof raw === "string" && raw.trim() ? raw : "Not supplied";
      return <div key={key}><dt>{FORM_FIELDS[key].title}</dt><dd>{value}</dd></div>;
    })}</dl>
    {section === "C" && <>
      {submission.snapshot.attributionChecks.map((check) => <div className="review-evidence" key={check.row}><strong>Row {check.row} · {check.verified ? "Mapping verified at submission" : "Unverified attribution / compatibility"}</strong>
        <p>Reference: {form.sectionC?.[`article${check.row}`]} · Scope: {form.sectionCEvidence?.[check.row]?.scope || "No additional text scope recorded"}</p>
        {check.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
        {(form.sectionCEvidence?.[check.row]?.citations ?? []).map((citation: { documentId: string; title: string; edition?: string; page: number; reference?: string }, index: number) => <p key={index}>
          {submission.snapshot.references.some((source) => String(source.id) === String(citation.documentId)) ? <a href={`/api/submissions/${submission.id}/references/${citation.documentId}/pdf#page=${citation.page}`} target="_blank" rel="noreferrer">{citation.title} · {citation.edition} · {citation.reference} · physical PDF page {citation.page}</a> : `Source unavailable in snapshot: ${citation.title}, PDF page ${citation.page}`}
        </p>)}
        {check.report && <details><summary>Source-check detail frozen at submission</summary><ul>{(check.report.blockers ?? []).map((item: string) => <li key={item}>{item}</li>)}</ul>
          {(check.report.candidates ?? []).map((candidate: Record<string, any>) => <p key={candidate.id}>{candidate.source_reference} {candidate.source_scope} · {candidate.attribution_group} {candidate.statement_label} · source {candidate.verification_status} · compatibility {candidate.compatibility_status} · {candidate.source_title}, PDF pages {candidate.source_pdf_page_start}–{candidate.source_pdf_page_end}</p>)}
        </details>}
      </div>)}
      <p className="review-notice">Marking an application finding reviewed does not verify a source mapping, resolve edition compatibility, or establish technical compliance.</p>
    </>}
    {section === "D" && [1,2,3,4,5].filter((row) => form.sectionD?.[`document${row}`] || form.sectionDEvidence?.[row]).map((row) => {
      const evidence = form.sectionDEvidence?.[row]; const title = form.sectionD?.[`document${row}`]; const upload = submission.snapshot.documents.find((document) => document.original_filename === title);
      return <div className="review-evidence" key={row}><strong>Row {row}: {evidence?.status === "recommended" ? "Documentation recommendation" : "Applicant document entry"}</strong>
        <p>{title || "No document title supplied"} · {upload ? "Uploaded PDF with matching filename; relevance still needs review" : "No uploaded PDF associated by exact filename"}</p>
        <p>Named responsible person / organization supplied by applicant: <strong>{form.sectionD?.[`responsible${row}`] || "Not provided"}</strong></p>
        {evidence && <><p>Recommended professional role (not an assigned person): {evidence.professionalRole || "Not assessed"}</p><p>Technical issues: {evidence.technicalIssues}</p><p>Code references: {evidence.codeReferences}</p><p>Professional involvement screening: {evidence.engineeringAssessment || "not_assessed"} · {evidence.engineeringRationale}</p><p>Recommendation source: {evidence.source}</p></>}
      </div>;
    })}
  </details>)}
  <details className="review-section"><summary>Suggestions and their submitted review status ({submission.snapshot.suggestions.length})</summary>
    {submission.snapshot.suggestions.map((suggestion) => <div className="review-evidence" key={suggestion.id}><strong>{suggestion.field_key} · {suggestion.status}</strong><p>{suggestion.suggested_value}</p><p>{suggestion.explanation}</p><p>Source verification is retained separately from accepting a suggestion.</p></div>)}
  </details>
  {Boolean(submission.snapshot.messages?.length) && <details className="review-section"><summary>Submitted conversation context</summary><p>Conversation is supporting context. Assistant statements and candidate citations are not independent verification or a compliance decision.</p>{submission.snapshot.messages?.map((message) => <div className="review-evidence" key={message.id}><strong>{message.role === "user" ? "Applicant" : "Assistant"}</strong><p>{message.content}</p></div>)}</details>}</>;
}
export function SubmissionPanel({ submissionId, canReview = false, onChanged }: { submissionId: string; canReview?: boolean; onChanged?: () => void }) {
  const [activeId,setActiveId] = useState(submissionId);
  const [submission,setSubmission] = useState<SubmissionDetail | null>(null);
  const [error,setError] = useState(""); const [busy,setBusy] = useState(false); const [statusNote,setStatusNote] = useState("");
  const [documentId,setDocumentId] = useState(""); const [filter,setFilter] = useState("all");
  useEffect(() => {
    const controller = new AbortController();
    void api<SubmissionDetail>(`/api/submissions/${activeId}`,{ signal: controller.signal }).then(setSubmission).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  },[activeId]);
  async function action(path: string, body: unknown) {
    setBusy(true); setError("");
    try { await post(path,body); setSubmission(await api<SubmissionDetail>(`/api/submissions/${activeId}`)); onChanged?.(); }
    catch (error) { setError(error instanceof Error ? error.message : "Review action failed."); throw error; }
    finally { setBusy(false); }
  }
  if (!submission) return <p role={error ? "alert" : "status"}>{error || "Loading submitted snapshot…"}</p>;
  const actionable = canReview && submission.is_latest && submission.status === "submitted";
  const form = submission.snapshot.application.form_data;
  const preview = documentId ? `/api/submissions/${submission.id}/documents/${documentId}/pdf` : `/api/submissions/${submission.id}/preview.pdf`;
  const outstanding = submission.findings.filter((finding) => finding.review_status !== "reviewed").length;
  return <div className="review-submission">
    <div className="review-heading"><div><span className="review-eyebrow">Frozen submission · Revision {submission.revision}</span><h2>{submission.snapshot.application.title}</h2><p>{form.applicant?.ownerName || "Applicant not supplied"} · {submission.snapshot.application.jurisdiction || "Jurisdiction not supplied"} · Submitted {timestamp(submission.submitted_at)}</p></div><span className="review-badge">{workflowLabels[submission.status]}</span></div>
    {submission.history && submission.history.length > 1 && <label>Submission history <select aria-label="Submission revision" value={activeId} disabled={busy} onChange={(event) => { if (event.target.value !== activeId) { setActiveId(event.target.value); setSubmission(null); setDocumentId(""); setError(""); setStatusNote(""); } }}>
      {submission.history.map((revision) => <option key={revision.id} value={revision.id}>Revision {revision.revision} · {workflowLabels[revision.status]} · {timestamp(revision.submitted_at)}</option>)}
    </select></label>}
    <p className="review-notice">Administrative completeness and supporting-information review only. “Review complete” is an internal checklist state, not approval, refusal, technical certification, or a finding of code compliance. The submitted PDF and documents do not change when the working draft is edited.</p>
    {!submission.is_latest && <p className="review-notice">Historical revision. Actions are available only on the latest open submission.</p>}
    {error && <p className="review-error" role="alert">{error}</p>}
    <div className="review-detail-grid"><div>
      <SubmittedSections submission={submission} />
      <details className="review-section"><summary>Original reference PDFs frozen at submission</summary><p>Available reference material is not a declaration of applicability. National intent compatibility remains provision-specific and may be unverified. STANDATA and municipal guidance, when supplied, apply only within their stated scope and do not approve a project.</p>
        <ul className="review-reference-list">{submission.snapshot.references.map((source) => <FrozenReference key={source.id} submissionId={submission.id} source={source} />)}</ul>
      </details>
      {Boolean(submission.snapshot.referenceCandidates?.length) && <details className="review-section"><summary>Reference library candidates frozen at submission</summary><p>These library records are not accepted application attributions. They preserve exact provision scopes, source pages and existing review/compatibility statuses for inspection.</p>
        {submission.snapshot.referenceCandidates?.map((candidate) => <div className="review-evidence" key={candidate.id}><strong>{candidate.target_reference} {candidate.target_scope} · {candidate.attribution_group} {candidate.statement_label}</strong><p>Source mapping: {candidate.verification_status.replaceAll("_"," ")} · Edition compatibility: {candidate.compatibility_status}</p><p>{candidate.statement_text}</p><p>Exact source reference: {candidate.source_reference} {candidate.source_scope}</p><a href={`/api/submissions/${submission.id}/references/${candidate.source_document_id}/pdf#page=${candidate.source_pdf_page_start}`} target="_blank" rel="noreferrer">{candidate.source_title} · {candidate.source_edition} · physical PDF pages {candidate.source_pdf_page_start}–{candidate.source_pdf_page_end}</a></div>)}
      </details>}
    </div><aside className="review-preview">
      <label htmlFor={`review-pdf-${submission.id}`}>Submitted PDF to inspect</label><select id={`review-pdf-${submission.id}`} value={documentId} onChange={(event) => setDocumentId(event.target.value)}><option value="">Variance application · frozen PDF</option>{submission.snapshot.documents.map((document) => <option key={document.id} value={document.id}>Uploaded: {document.original_filename}</option>)}</select>
      <a href={preview} target="_blank" rel="noreferrer">Open / download submitted PDF</a>
      <div className="review-pdf"><Suspense fallback={<p>Loading PDF viewer…</p>}><VariancePreview key={preview} url={preview} label="Submitted application or uploaded document" /></Suspense></div>
      <p className="review-small">{submission.snapshot.documents.length} uploaded PDFs. Recommendations in Section D are listed separately; they do not create uploaded reports.</p>
    </aside></div>
    <section className="review-findings"><div className="review-heading"><h3>Completeness findings</h3><span>{outstanding} of {submission.findings.length} await reviewer assessment</span></div>
      <p className="review-small">Source status and reviewer assessment are separate. A reviewed “unverified” finding remains unverified.</p>
      <label htmlFor={`finding-filter-${submission.id}`}>Filter findings</label><select id={`finding-filter-${submission.id}`} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All findings</option><option value="unreviewed">Awaiting assessment</option>{Object.entries(findingLabels).map(([status,label]) => <option key={status} value={status}>{label}</option>)}</select>
      <div className="review-finding-grid">{submission.findings.filter((finding) => filter === "all" || filter === "unreviewed" ? filter === "all" || finding.review_status === "unreviewed" : finding.status === filter).map((finding) => <FindingCard key={finding.id} finding={finding} notes={submission.events.filter((event) => event.finding_id === finding.id)} actionable={actionable} busy={busy} onAction={(id,status,note) => action(`/api/reviewer/submissions/${submission.id}/findings/${id}`,{ reviewStatus: status,note })} />)}</div>
    </section>
    {actionable && <section className="review-outcome"><h3>Internal review status</h3><label htmlFor={`review-status-note-${submission.id}`}>Reviewer summary / requested changes</label><textarea id={`review-status-note-${submission.id}`} rows={3} value={statusNote} onChange={(event) => setStatusNote(event.target.value)} maxLength={5000} disabled={busy} />
      <p>Review complete requires every finding to be assessed as reviewed. This acknowledges inspection; missing or unverified source facts stay visible.</p>
      <div className="review-buttons"><button type="button" disabled={busy || !statusNote.trim()} onClick={() => void action(`/api/reviewer/submissions/${submission.id}/status`,{ status: "changes_requested",note: statusNote }).then(() => setStatusNote("")).catch(() => undefined)}>Request changes</button><button type="button" disabled={busy || !statusNote.trim() || outstanding > 0} onClick={() => void action(`/api/reviewer/submissions/${submission.id}/status`,{ status: "review_complete",note: statusNote }).then(() => setStatusNote("")).catch(() => undefined)}>Mark review complete</button></div>
    </section>}
    <details className="review-section" open><summary>Review history and notes ({submission.events.length})</summary>{submission.events.length === 0 && <p>No reviewer actions yet.</p>}{submission.events.map((event) => <div className="review-evidence" key={event.id}><strong>{event.action.replaceAll("_"," ")}</strong><p>{event.note || "Finding marked reviewed."}</p><p className="review-small">{event.actor_id} · {timestamp(event.created_at)}{event.finding_id && ` · Finding ${event.finding_id}`}</p></div>)}</details>
  </div>;
}
export default function ReviewerWorkspace() {
  const [queue,setQueue] = useState<QueueItem[]>([]); const [selected,setSelected] = useState(""); const [error,setError] = useState("");
  async function refresh() { try { setQueue(await api<QueueItem[]>("/api/reviewer/queue")); setError(""); } catch (error) { setError(error instanceof Error ? error.message : "Could not load queue."); } }
  useEffect(() => { const controller = new AbortController(); void api<QueueItem[]>("/api/reviewer/queue",{ signal: controller.signal }).then((items) => {
    setQueue(items);
    const previous = readDemoSelection("review-application");
    const saved = items.find((item) => item.application_id === previous);
    if (saved) setSelected(saved.id);
  }).catch((error) => { if (!controller.signal.aborted) setError(error.message); }); return () => controller.abort(); },[]);
  return <main className="review-workspace"><aside className="review-queue"><div className="review-heading"><h1>Reviewer queue</h1><button type="button" onClick={() => void refresh()}>Refresh</button></div><p>Latest submitted revision for each application. Drafts are private to the applicant.</p>
    {error && <p role="alert" className="review-error">{error}</p>}{queue.length === 0 && <p>No applications have been submitted for review.</p>}
    {queue.map((item) => <button className="review-queue-item" type="button" key={item.id} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); saveDemoSelection("review-application",item.application_id); }}><strong>{item.title}</strong><span>{item.applicant || "Applicant not supplied"} · {item.jurisdiction || "Jurisdiction not supplied"}</span><span>{workflowLabels[item.status]} · Revision {item.revision}</span><span>Submitted {timestamp(item.submitted_at)}</span><span>{item.flagged_count} flagged / {item.finding_count} findings · {item.unreviewed_count} awaiting assessment</span></button>)}
  </aside><section className="review-selected">{selected ? <SubmissionPanel key={selected} submissionId={selected} canReview onChanged={() => void refresh()} /> : <div className="review-empty"><h2>Inspect a submitted application</h2><p>Select a queue item to view its frozen PDF, supporting information and administrative findings.</p></div>}</section></main>;
}
