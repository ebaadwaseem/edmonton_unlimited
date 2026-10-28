import { useEffect, useId, useState } from "react";
import type { AttributionReport as Report } from "../shared/attribution-types";
type CodeDocument = { id: string; title: string; edition: string; jurisdiction: string };
const articles = ["3.8.3.5.", "3.8.3.20.", "3.8.3.2.", "3.8.3.6.", "3.8.3.13."];
export default function SectionCReferences() {
  const id = useId();
  const [documents, setDocuments] = useState<CodeDocument[]>([]);
  const [documentId, setDocumentId] = useState("");
  const [reference, setReference] = useState(articles[0]);
  const [scope, setScope] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/attributions/documents", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load reference editions.");
      const documents: CodeDocument[] = await response.json();
      setDocuments(documents);
      if (documents.length === 1) { setDocumentId(String(documents[0].id)); setLoading(true); }
    }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!documentId || !reference.trim()) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ documentId, reference: reference.trim(), scope });
    void fetch(`/api/attributions?${params}`, { signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not inspect source mappings.");
      setReport(body);
    }).catch((error) => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [documentId, reference, scope]);
  function select(nextDocument: string, nextReference: string, nextScope = "") {
    if (nextDocument === documentId && nextReference === reference && nextScope === scope) return;
    setDocumentId(nextDocument); setReference(nextReference); setScope(nextScope);
    setReport(null); setError(""); setLoading(Boolean(nextDocument && nextReference.trim()));
  }
  return <div className="variance-reference-review">
    <h3>Check attribution sources</h3>
    <p>Choose an edition and exact provision. Extracted candidates need source review; national intent also needs an explicit compatibility review before use in an Alberta mapping.</p>
    <label htmlFor={`${id}-edition`}>Reference edition</label>
    <select id={`${id}-edition`} value={documentId} onChange={(event) => select(event.target.value, reference)}>
      <option value="">Select a code edition…</option>
      {documents.map((document) => <option key={document.id} value={document.id}>{document.title} · {document.edition} · {document.jurisdiction}</option>)}
    </select>
    <label htmlFor={`${id}-reference`}>Article, sentence, clause or subclause</label>
    <input id={`${id}-reference`} value={reference} onChange={(event) => select(documentId, event.target.value)} maxLength={100} />
    <div className="variance-reference-choices">{articles.map((article) => <button type="button" className="variance-secondary" key={article} onClick={() => select(documentId, article)}>{article}</button>)}</div>
    {scope && <p><strong>Selected text scope:</strong> {scope}</p>}
    {loading && <p role="status">Checking exact source mappings…</p>}
    {error && <p role="alert">{error}</p>}
    {report && <>
      <strong className={report.verified ? "" : "variance-reference-blocked"}>{report.verified ? "Complete reviewed mapping available" : "Not ready for verified use"}</strong>
      <ul>{report.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
      {report.available.length > 0 && <details open={!report.provision}><summary>Available provision candidates (partial coverage)</summary>
        <p>Each scope is separate. These candidates do not cover every provision in the article.</p>
        {report.available.map((item) => <button type="button" className="variance-secondary" key={item.id} onClick={() => select(documentId, item.reference, item.scope)}>{item.reference} {item.scope} · {item.level} · {item.status.replaceAll("_", " ")}</button>)}
      </details>}
      {report.candidates.map((candidate) => <details key={candidate.id}>
        <summary>{candidate.kind === "intent" ? candidate.statement_label || "Intent" : candidate.attribution_group} · {candidate.verification_status.replaceAll("_", " ")}</summary>
        <p><strong>Exact source reference:</strong> {candidate.source_reference} {candidate.source_scope}</p>
        <p>{candidate.statement_text}</p>
        <p><a href={`/api/reference-documents/${candidate.source_document_id}/pdf#page=${candidate.source_pdf_page_start}`} target="_blank" rel="noreferrer">{candidate.source_title} · {candidate.source_edition} · physical PDF pages {candidate.source_pdf_page_start}–{candidate.source_pdf_page_end}</a></p>
        <p><strong>Edition compatibility:</strong> {String(candidate.source_document_id) === documentId ? "Same code document; source attribution still requires review." : candidate.compatibility_status.replaceAll("_", " ")}</p>
        {candidate.compatibility_basis && <p>{candidate.compatibility_basis}</p>}
      </details>)}
    </>}
  </div>;
}
