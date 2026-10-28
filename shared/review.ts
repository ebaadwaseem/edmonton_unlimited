export type WorkflowStatus = "draft" | "submitted" | "changes_requested" | "review_complete";
export type FindingStatus = "missing" | "needs_clarification" | "unverified" | "provided" | "not_applicable";
export type Finding = { key: string; section: string; title: string; status: FindingStatus; detail: string };
export type ReviewedFinding = Finding & { id: string; finding_key: string; review_status: "unreviewed" | "reviewed" | "needs_clarification"; reviewed_by: string | null; updated_at: string };
export type SubmissionSnapshot = {
  application: { id: string; title: string; jurisdiction: string; form_data: Record<string, any> };
  documents: { id: string; original_filename: string; page_count: number; uploaded_at: string; sha256: string }[];
  suggestions: { id: string; field_key: string; suggested_value: string; status: string; explanation: string; metadata: Record<string, any> }[];
  attributionChecks: { row: number; verified: boolean; blockers: string[]; report?: Record<string, any> }[];
  references: { id: string; title: string; edition: string; jurisdiction: string; page_count: number; sha256: string }[];
  messages?: { id: string; role: string; content: string; created_at: string }[];
  referenceCandidates?: { id: string; target_reference: string; target_scope: string; kind: string; attribution_group: string; statement_label: string; statement_text: string; source_document_id: string; source_reference: string; source_scope: string; source_title: string; source_edition: string; source_pdf_page_start: number; source_pdf_page_end: number; verification_status: string; compatibility_status: string }[];
};
export type ReviewEvent = { id: string; finding_id: string | null; actor_id: string; action: string; note: string; created_at: string };
export type SubmissionDetail = { id: string; application_id: string; revision: number; submitted_at: string; status: WorkflowStatus; status_updated_at: string; status_updated_by: string | null; is_latest: boolean; history?: { id: string; revision: number; status: WorkflowStatus; submitted_at: string }[]; snapshot: SubmissionSnapshot; findings: ReviewedFinding[]; events: ReviewEvent[] };
export const workflowLabels: Record<WorkflowStatus, string> = { draft: "Draft", submitted: "Submitted", changes_requested: "Changes requested", review_complete: "Review complete" };
export const findingLabels: Record<FindingStatus, string> = { missing: "Missing", needs_clarification: "Needs clarification", unverified: "Unverified", provided: "Provided", not_applicable: "Optional / not applicable" };
