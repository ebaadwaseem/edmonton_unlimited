import { createHash } from "node:crypto";
import { db } from "./db.ts";
import { parseProvisionReference } from "../shared/provision-reference.ts";

export async function inspectAttributions(documentId: number, reference: string, scope = "") {
  const parsed = parseProvisionReference(reference, scope);
  const document = (await db.query("SELECT id, title, edition, jurisdiction, page_count, reference_role FROM documents WHERE id = $1", [documentId])).rows[0];
  if (!document) throw new Error("Code document not found.");
  const provisions = (await db.query(`SELECT p.*, p.document_sha256 = encode(sha256(d.file_bytes), 'hex') AS source_unchanged
    FROM code_provisions p JOIN documents d ON d.id = p.document_id
    WHERE p.document_id = $1 AND p.article_number = $2 ORDER BY p.reference, p.scope`, [documentId, parsed.article])).rows;
  const provision = provisions.find((p) => p.reference === parsed.reference && p.scope === parsed.scope);
  const candidates = provision ? (await db.query(`SELECT a.*, d.title AS source_title, d.edition AS source_edition,
      d.jurisdiction AS source_jurisdiction, d.page_count AS source_page_count,
      a.source_sha256 = encode(sha256(d.file_bytes), 'hex') AS source_unchanged
    FROM provision_attributions a JOIN documents d ON d.id = a.source_document_id
    WHERE a.provision_id = $1 ORDER BY a.id`, [provision.id])).rows : [];
  const blockers: string[] = [];
  if (!document.edition || !document.jurisdiction || document.reference_role !== "code") blockers.push("The selected code document needs an explicit edition and jurisdiction.");
  if (!provision) blockers.push("No mapping is stored for this exact reference and scope. Select an available provision or import a candidate; article-level lookup does not combine sentence or clause mappings.");
  else {
    if (provision.reference_level !== parsed.level) blockers.push("The stored reference level does not match the requested identifier and scope.");
    if (provision.verification_status !== "verified" || !provision.reviewed_by?.trim() || !provision.reviewed_at || !provision.review_basis?.trim()) blockers.push("The provision and completeness of its attribution set need authorized source review.");
    if (!provision.source_unchanged || provision.pdf_page_end > document.page_count) blockers.push("The target source changed or its page range is invalid.");
  }
  const active = candidates.filter((row) => row.verification_status !== "rejected");
  const missing = (["objective_functional", "intent"] as const).filter((kind) => !active.some((row) => row.kind === kind));
  for (const kind of missing) blockers.push(`Missing ${kind === "intent" ? "intent statement" : "objective/functional attribution"} for the exact provision and scope.`);
  for (const row of active) {
    if (row.verification_status !== "verified" || !row.reviewed_by?.trim() || !row.reviewed_at || !row.review_basis?.trim()) blockers.push(`Candidate ${row.id}: source attribution is unverified.`);
    if (!row.source_unchanged || row.source_pdf_page_end > row.source_page_count || !row.source_edition || !row.source_jurisdiction) blockers.push(`Candidate ${row.id}: source metadata, fingerprint or page range needs review.`);
    if (String(row.source_document_id) !== String(documentId) && (row.compatibility_status !== "verified" || !row.compatibility_basis?.trim() || !row.compatibility_reviewed_by?.trim() || !row.compatibility_reviewed_at)) blockers.push(`Candidate ${row.id}: edition/provision compatibility is ${row.compatibility_status}; source review alone does not establish compatibility.`);
    if (row.kind === "objective_functional" && (!row.objective_ids.length || !row.functional_ids.length)) blockers.push(`Candidate ${row.id}: incomplete objective/functional pair.`);
  }
  return { document, requested: parsed, provision: provision ?? null, available: provisions.map((p) => ({ id: p.id, reference: p.reference, level: p.reference_level, scope: p.scope, status: p.verification_status })), candidates,
    missing, verified: blockers.length === 0, blockers };
}

export async function lookupVerifiedAttributions(documentId: number, reference: string, scope = "") {
  const report = await inspectAttributions(documentId, reference, scope);
  if (!report.verified || !report.provision) return null;
  const { document, provision } = report;
  const active = report.candidates.filter((row) => row.verification_status === "verified");
  const pairs = active.filter((row) => row.kind === "objective_functional");
  const intents = active.filter((row) => row.kind === "intent");
  return { id: provision.id, article_number: provision.article_number, reference: provision.reference, reference_level: provision.reference_level, scope: provision.scope,
    document_id: document.id, title: document.title, edition: document.edition, jurisdiction: document.jurisdiction,
    objective: [...new Set(pairs.flatMap((row) => row.objective_ids))].join("\n"),
    function: [...new Set(pairs.flatMap((row) => row.functional_ids))].join("\n"),
    intent: intents.map((row) => row.statement_text).join("\n"),
    statements: active.map((row) => ({ type: row.kind, identifier: row.statement_label || row.attribution_group, text: row.statement_text,
      sourceReference: row.source_reference, scope: row.source_scope, attributionGroup: row.attribution_group, compatibility: row.compatibility_status,
      reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, compatibilityBasis: row.compatibility_basis })),
    citations: [{ documentId: document.id, title: document.title, edition: document.edition, page: provision.pdf_page_start, endPage: provision.pdf_page_end, type: "provision", reference: provision.reference, scope: provision.scope },
      ...active.map((row) => ({ documentId: row.source_document_id, title: row.source_title, edition: row.source_edition, page: row.source_pdf_page_start, endPage: row.source_pdf_page_end, type: row.kind, reference: row.source_reference, scope: row.source_scope }))] };
}

export function attributionFingerprint(mapping: NonNullable<Awaited<ReturnType<typeof lookupVerifiedAttributions>>>): string {
  return createHash("sha256").update(JSON.stringify(mapping)).digest("hex");
}
