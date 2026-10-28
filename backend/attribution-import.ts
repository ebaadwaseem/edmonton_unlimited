import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { parseProvisionReference } from "../shared/provision-reference.ts";
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
function required(v: unknown, label: string): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${label} is required.`);
  return v.trim();
}
function pages(start: unknown, end: unknown) {
  if (!positive(start) || !positive(end) || end < start) throw new Error("Provide a valid physical PDF page range.");
}
export function validateCandidateDataset(data: any) {
  if (!Array.isArray(data.documents) || !data.documents.length || !Array.isArray(data.provisions) || !data.provisions.length) throw new Error("Provide documents and provisions arrays; legacy article-only verified datasets are not supported.");
  for (const d of data.documents) {
    if (!positive(d.id) || !/^[a-f0-9]{64}$/.test(d.sha256) || !["code", "intent_supplement"].includes(d.role)) throw new Error("Document identity, SHA-256 and role are required.");
    required(d.edition, "Edition"); required(d.jurisdiction, "Jurisdiction");
  }
  for (const p of data.provisions) {
    if (!positive(p.document_id) || !data.documents.some((d: any) => d.id === p.document_id && d.role === "code")) throw new Error("Provision target must identify a code document in the manifest.");
    parseProvisionReference(required(p.reference, "Exact reference"), p.scope ?? "");
    pages(p.pdf_page_start, p.pdf_page_end);
    if (!Array.isArray(p.attributions) || !p.attributions.length) throw new Error("Provide at least one source candidate. Partial sets are allowed and shown as incomplete.");
    for (const a of p.attributions) {
      if (!["objective_functional", "intent"].includes(a.kind) || !data.documents.some((d: any) => d.id === a.source_document_id)) throw new Error("Invalid candidate kind or source document.");
      pages(a.source_pdf_page_start, a.source_pdf_page_end);
      required(a.source_reference, "Exact source reference"); required(a.source_excerpt, "Source excerpt"); required(a.statement_text, "Source statement text");
      if (a.verification_status && a.verification_status !== "needs_review" || a.compatibility_status && a.compatibility_status !== "unverified") throw new Error("Imports cannot verify mappings or edition compatibility. Use a separate authorized review record.");
      if (a.kind === "objective_functional" && (!Array.isArray(a.objective_ids) || !a.objective_ids.length || !a.objective_ids.every((s: unknown) => typeof s === "string" && /^O[A-Z]+\d+(?:\.\d+)*$/.test(s)) || !Array.isArray(a.functional_ids) || !a.functional_ids.length || !a.functional_ids.every((s: unknown) => typeof s === "string" && /^F\d+$/.test(s)))) throw new Error("Objective/functional candidates need exact identifiers in a paired attribution group.");
    }
  }
}
export async function importCandidates(client: PoolClient, data: any) {
  validateCandidateDataset(data);
  const manifests = new Map<number, any>();
  for (const d of data.documents) {
    const source = (await client.query("SELECT page_count, encode(sha256(file_bytes), 'hex') AS sha256 FROM documents WHERE id = $1 FOR UPDATE", [d.id])).rows[0];
    if (!source || source.sha256 !== d.sha256) throw new Error(`Document ${d.id}: source fingerprint does not match the manifest.`);
    if (!positive(source.page_count)) throw new Error(`Document ${d.id}: physical PDF page count is required.`);
    manifests.set(d.id, { ...d, page_count: source.page_count });
    await client.query("UPDATE documents SET edition = $1, jurisdiction = $2, reference_role = $3 WHERE id = $4", [d.edition, d.jurisdiction, d.role, d.id]);
  }
  let inserted = 0;
  for (const p of data.provisions) {
    const ref = parseProvisionReference(p.reference, p.scope ?? "");
    const target = manifests.get(p.document_id)!;
    if (p.pdf_page_end > target.page_count) throw new Error("Target page is outside the source PDF.");
    const provision = (await client.query(`INSERT INTO code_provisions (document_id, article_number, reference, reference_level, scope, pdf_page_start, pdf_page_end, document_sha256)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (document_id,reference,scope) DO UPDATE SET reference = EXCLUDED.reference RETURNING *`,
      [p.document_id, ref.article, ref.reference, ref.level, ref.scope, p.pdf_page_start, p.pdf_page_end, target.sha256])).rows[0];
    if (provision.document_sha256 !== target.sha256) throw new Error("Existing provision source changed. Preserve it and resolve the source version before importing.");
    if (provision.pdf_page_start !== p.pdf_page_start || provision.pdf_page_end !== p.pdf_page_end) {
      const corrected = await client.query(`UPDATE code_provisions SET pdf_page_start=$1,pdf_page_end=$2 WHERE id=$3
        AND verification_status='needs_review' AND NOT EXISTS (SELECT 1 FROM attribution_reviews WHERE provision_id=$3) RETURNING id`, [p.pdf_page_start, p.pdf_page_end, provision.id]);
      if (!corrected.rows.length) throw new Error("A reviewed provision's page range cannot be replaced by an import.");
    }
    for (const a of p.attributions) {
      const source = manifests.get(a.source_document_id)!;
      if (a.source_pdf_page_end > source.page_count) throw new Error("Candidate page is outside the source PDF.");
      const candidate = { kind: a.kind, objective_ids: a.objective_ids ?? [], functional_ids: a.functional_ids ?? [], attribution_group: a.attribution_group ?? "",
        statement_label: a.statement_label ?? "", statement_text: a.statement_text, source_document_id: a.source_document_id, source_reference: a.source_reference,
        source_scope: a.source_scope ?? "", source_pdf_page_start: a.source_pdf_page_start, source_pdf_page_end: a.source_pdf_page_end, source_sha256: source.sha256, source_excerpt: a.source_excerpt };
      const fingerprint = createHash("sha256").update(JSON.stringify(candidate)).digest("hex");
      const result = await client.query(`INSERT INTO provision_attributions (provision_id, kind, objective_ids, functional_ids, attribution_group, statement_label, statement_text, source_document_id, source_reference, source_scope, source_pdf_page_start, source_pdf_page_end, source_sha256, source_excerpt, candidate_fingerprint)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (provision_id,candidate_fingerprint) DO NOTHING RETURNING id`, [provision.id, ...Object.values(candidate), fingerprint]);
      inserted += result.rows.length;
      if (result.rows.length) await client.query("UPDATE code_provisions SET verification_status = 'needs_review', reviewed_by = NULL, reviewed_at = NULL, review_basis = NULL WHERE id = $1", [provision.id]);
    }
  }
  return inserted;
}

// An explicit review file records an external review; this prototype cannot
// authenticate a reviewer. Running an import is never itself source review.
export async function recordAttributionReview(client: PoolClient, review: any) {
  const reviewer = required(review.reviewed_by, "Authorized reviewer");
  const basis = required(review.review_basis, "Source review and completeness basis");
  if (!positive(review.provision_id) || !Array.isArray(review.decisions) || !review.decisions.length) throw new Error("Specify a provision and a decision for every candidate.");
  const target = (await client.query("SELECT p.*, encode(sha256(d.file_bytes), 'hex') AS current_sha256 FROM code_provisions p JOIN documents d ON d.id=p.document_id WHERE p.id=$1 FOR UPDATE OF p", [review.provision_id])).rows[0];
  if (!target || review.expected_target_sha256 !== target.current_sha256 || target.document_sha256 !== target.current_sha256) throw new Error("Target source fingerprint changed or was not explicitly confirmed.");
  const rows = (await client.query("SELECT a.*, encode(sha256(d.file_bytes), 'hex') AS current_sha256 FROM provision_attributions a JOIN documents d ON d.id=a.source_document_id WHERE provision_id=$1 FOR UPDATE OF a", [review.provision_id])).rows;
  if (rows.length !== review.decisions.length || new Set(review.decisions.map((d: any) => d.id)).size !== rows.length) throw new Error("Review every candidate exactly once to attest completeness.");
  for (const decision of review.decisions) {
    const candidate = rows.find((r) => String(r.id) === String(decision.id));
    if (!candidate || candidate.candidate_fingerprint !== decision.fingerprint || candidate.current_sha256 !== candidate.source_sha256) throw new Error("A reviewed candidate or source changed.");
    if (!["verified", "rejected", "needs_review"].includes(decision.status)) throw new Error("Invalid mapping review status.");
    const compatibility = decision.compatibility?.status ?? "unverified";
    if (!["verified", "unverified", "incompatible"].includes(compatibility)) throw new Error("Invalid compatibility review status.");
    const compatibilityBasis = compatibility !== "unverified" ? required(decision.compatibility?.basis, "Edition/provision compatibility evidence") : null;
    await client.query(`UPDATE provision_attributions SET verification_status=$1,reviewed_by=$2,reviewed_at=NOW(),review_basis=$3,
      compatibility_status=$4,compatibility_basis=$5,compatibility_reviewed_by=$6,compatibility_reviewed_at=CASE WHEN $6::text IS NULL THEN NULL ELSE NOW() END WHERE id=$7`,
      [decision.status, reviewer, basis, compatibility, compatibilityBasis, compatibility === "unverified" ? null : reviewer, candidate.id]);
  }
  await client.query("UPDATE code_provisions SET verification_status='verified',reviewed_by=$1,reviewed_at=NOW(),review_basis=$2 WHERE id=$3", [reviewer, basis, target.id]);
  await client.query("INSERT INTO attribution_reviews (provision_id,review_record) VALUES ($1,$2::jsonb)", [target.id, JSON.stringify(review)]);
}
