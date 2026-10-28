import type { Finding, SubmissionSnapshot } from "../shared/review.ts";
export function buildCompletenessFindings(snapshot: SubmissionSnapshot): Finding[] {
  const form = snapshot.application.form_data;
  const findings: Finding[] = [];
  const filled = (v: unknown) => typeof v === "string" && Boolean(v.trim());
  const add = (key: string, section: string, title: string, status: Finding["status"], detail: string) => findings.push({ key, section, title, status, detail });
  const field = (key: string, section: string, title: string, value: unknown, optional = false) => add(key, section, title, filled(value) ? "provided" : optional ? "not_applicable" : "missing", filled(value) ? "Applicant supplied a value; accuracy and technical suitability are not established." : optional ? "Optional for this demo's administrative checklist; omission is not a deficiency." : "No value supplied in the submitted snapshot.");
  field("A.owner", "A", "Owner / applicant name", form.applicant?.ownerName);
  field("A.address", "A", "Applicant mailing address", form.applicant?.mailingAddress);
  field("A.date", "A", "Request date", form.applicant?.requestDate);
  field("A.representative", "A", "Owner representative", form.applicant?.representative, true);
  field("B.jurisdiction", "B", "Jurisdiction", snapshot.application.jurisdiction);
  if (form.project?.jurisdictionWide === true) add("B.address", "B", "Project location", "not_applicable", "Applicant indicates a jurisdiction-wide proposal. Reviewer must confirm that this scope is appropriate. This is separate from the SCC-submission checkbox.");
  else field("B.address", "B", "Municipal project address", form.project?.municipalAddress);
  field("B.permit", "B", "Permit number (if applicable)", form.project?.permitNumber, true);
  add("B.scc", "B", "SCC-submission declaration", "provided", form.project?.sccSubmitted === true ? "Applicant selected submitted to SCC for jurisdictional review. This is an applicant declaration, not confirmation of submission or acceptance." : "SCC-submission checkbox is not selected. This does not block internal administrative review.");
  const ats = ["lot", "block", "plan", "quarter", "section", "township", "range", "meridian"].filter((key) => filled(form.project?.[key]));
  add("B.ats", "B", "ATS / legal location", ats.length ? "needs_clarification" : "not_applicable", ats.length ? "Legal location information is supplied. Confirm its applicable survey system and completeness; ATS is not inferred from the municipal address." : "No ATS values supplied; optional for this demo checklist when not applicable.");
  field("C.code", "C", "Applicable code and edition", form.sectionC?.code);
  let rows = 0;
  for (let row = 1; row <= 5; row++) {
    if (!["article", "objective", "function", "intent"].some((column) => filled(form.sectionC?.[`${column}${row}`]))) continue;
    rows++;
    for (const column of ["article", "objective", "function", "intent"]) field(`C.${row}.${column}`, "C", `Row ${row}: ${column === "article" ? "exact code provision / scope" : column}`, form.sectionC?.[`${column}${row}`]);
    const check = snapshot.attributionChecks.find((check) => check.row === row);
    add(`C.${row}.verification`, "C", `Row ${row}: source attribution and edition compatibility`, check?.verified ? "provided" : "unverified", check?.verified ? "The source mapping passed the existing exact-provision verification gate at submission. Administrative review does not change that source review." : check?.blockers.join(" ") || "No complete reviewed exact-edition/provision/scope mapping is attached. Manual text and search matches do not establish compatibility.");
  }
  if (!rows) add("C.provisions", "C", "Selected code provisions", "missing", "No Section C provision row supplied. Candidate articles discussed in conversation are not accepted form values.");
  let documents = 0;
  for (let row = 1; row <= 5; row++) {
    const title = form.sectionD?.[`document${row}`];
    const responsible = form.sectionD?.[`responsible${row}`];
    const evidence = form.sectionDEvidence?.[row];
    if (!filled(title) && !filled(responsible) && !evidence) continue;
    documents++;
    const upload = snapshot.documents.find((document) => document.original_filename === title);
    add(`D.${row}.document`, "D", `Row ${row}: supporting document`, upload ? "provided" : filled(title) ? "needs_clarification" : "missing", upload ? `An uploaded PDF has this exact filename (${upload.page_count} pages). A matching filename does not establish relevance, completeness, authorship or technical adequacy.` : evidence?.status === "recommended" ? `Recommended only: ${title || "untitled"}. No uploaded PDF is explicitly associated by exact filename. A recommendation is not a completed report.` : "Document described or responsible party supplied, but no uploaded PDF is associated by exact filename. Clarify whether the document has been provided.");
    add(`D.${row}.responsible`, "D", `Row ${row}: actual responsible person / organization`, filled(responsible) ? "provided" : "needs_clarification", filled(responsible) ? `Applicant-provided name: ${responsible}. Identity, licence and engagement are not verified.` : `No actual responsible party named.${evidence?.professionalRole ? ` Recommended role only: ${evidence.professionalRole}.` : ""} Confirm whether a named party is applicable; do not infer a name from a role recommendation.`);
    if (evidence) add(`D.${row}.screening`, "D", `Row ${row}: professional involvement screening`, !evidence.engineeringAssessment || evidence.engineeringAssessment === "not_assessed" ? "needs_clarification" : "provided", `${evidence.engineeringAssessment ?? "not_assessed"}: ${evidence.engineeringRationale ?? "Screening rationale not supplied."} Screening is not professional certification or technical compliance.`);
  }
  if (!documents) add("D.scope", "D", "Supporting documentation scope", "needs_clarification", "No Section D documentation entries. Reviewer must determine what supporting information is appropriate to this proposal; the checklist cannot determine technical sufficiency.");
  for (const document of snapshot.documents) add(`upload.${document.id}`, "D", `Uploaded: ${document.original_filename}`, "provided", `${document.page_count} physical PDF pages supplied. Presence does not establish technical sufficiency or fulfil a recommendation automatically.`);
  const pending = snapshot.suggestions.filter((suggestion) => suggestion.status === "pending").length;
  if (pending) add("suggestions.pending", "C", "Unaccepted suggestions", "unverified", `${pending} suggestions remain pending. They are preserved separately and have not been applied to the submitted form.`);
  return findings;
}
