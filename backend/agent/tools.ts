import { PDFDocument } from "pdf-lib";
import { db } from "../db.ts";
import { AGENT_FIELD_KEYS, isFormFieldKey, validateFieldValue } from "../../shared/form-fields.ts";
import { attributionFingerprint, inspectAttributions, lookupVerifiedAttributions } from "../attributions.ts";
import { renderPdfPage } from "./render-page.ts";

type ToolOutput = string | Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string }>;
function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error("Document ID and page number must be positive integers.");
  return value;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new Error(`Expected text between 1 and ${maximum} characters.`);
  return value.trim();
}

export function createToolHandlers(applicationId: number, signal?: AbortSignal) {
  const viewPage = async (args: Record<string, unknown>, uploaded: boolean): Promise<ToolOutput> => {
    const documentId = positiveInteger(args.document_id);
    const page = positiveInteger(args.page_number);
    const result = uploaded
      ? await db.query(`SELECT original_filename AS title, page_count, file_bytes
          FROM application_documents WHERE id = $1 AND application_id = $2`, [documentId, applicationId])
      : await db.query(`SELECT title, page_count, file_bytes FROM documents WHERE id = $1`, [documentId]);
    const document = result.rows[0];
    if (!document) throw new Error("Document was not found.");
    // Older uploads may not have a cached page count yet.
    const pageCount = document.page_count ?? (await PDFDocument.load(document.file_bytes)).getPageCount();
    if (page > pageCount) throw new Error(`This document has ${pageCount} pages.`);
    if (uploaded && !document.page_count) {
      await db.query(`UPDATE application_documents SET page_count = $1 WHERE id = $2 AND application_id = $3`,
        [pageCount, documentId, applicationId]);
    }
    return [
      { type: "input_text", text: `${uploaded ? "Uploaded" : "Original"} PDF "${document.title}", physical page ${page} of ${pageCount}.` },
      { type: "input_image", image_url: await renderPdfPage(document.file_bytes, page, signal) },
    ];
  };

  async function saveSuggestion(fieldKey: string, value: string, explanation: string, metadata: object = {}) {
    signal?.throwIfAborted();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM applications WHERE id = $1 FOR UPDATE", [applicationId]);
      await client.query("UPDATE form_suggestions SET status = 'rejected' WHERE application_id = $1 AND field_key = $2 AND status = 'pending'", [applicationId, fieldKey]);
      const result = await client.query(`INSERT INTO form_suggestions (application_id, field_key, suggested_value, explanation, metadata)
        VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id, field_key, suggested_value, explanation, metadata, status`,
        [applicationId, fieldKey, value, explanation, JSON.stringify(metadata)]);
      signal?.throwIfAborted();
      await client.query("COMMIT"); return JSON.stringify(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  function rowNumber(value: unknown) {
    const row = positiveInteger(value);
    if (row > 5) throw new Error("Part 1 has five rows. Review or replace an existing row; additional rows cannot be silently dropped.");
    return row;
  }

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<ToolOutput>> = {
    async search_code(args) {
      const search = text(args.query, 200);
      const result = await db.query(`
        SELECT t.document_id, t.title, t.edition, t.jurisdiction, t.pdf_page_number,
          ts_headline('english', t.extracted_text, websearch_to_tsquery('english', $1),
            'MaxFragments=2, MinWords=15, MaxWords=40') AS snippet
        FROM (
          SELECT d.id AS document_id, d.title, d.edition, d.jurisdiction,
            p.pdf_page_number, p.extracted_text
          FROM document_pages p JOIN documents d ON d.id = p.document_id
          WHERE p.search_vector @@ websearch_to_tsquery('english', $1)
          ORDER BY ts_rank(p.search_vector, websearch_to_tsquery('english', $1)) DESC,
            d.id, p.pdf_page_number LIMIT 5
        ) t`, [search]);
      if (result.rows.length) return JSON.stringify(result.rows);
      // Literal fallback for identifiers that full-text tokenization cannot find.
      const literal = search.replace(/[\\%_]/g, "\\$&");
      const fallback = await db.query(`
        SELECT d.id AS document_id, d.title, d.edition, d.jurisdiction, p.pdf_page_number,
          substring(p.extracted_text FROM greatest(1, strpos(lower(p.extracted_text), lower($1)) - 150) FOR 700) AS snippet
        FROM document_pages p JOIN documents d ON d.id = p.document_id
        WHERE p.extracted_text ILIKE $2
        ORDER BY d.id, p.pdf_page_number LIMIT 5`, [search, `%${literal}%`]);
      return JSON.stringify(fallback.rows);
    },
    async list_application_documents() {
      const result = await db.query(`SELECT id, original_filename, page_count, uploaded_at
        FROM application_documents WHERE application_id = $1 ORDER BY id`, [applicationId]);
      return JSON.stringify(result.rows);
    },
    view_document_page: (args) => viewPage(args, false),
    view_application_page: (args) => viewPage(args, true),
    async get_application_draft() {
      const result = await db.query("SELECT form_data FROM applications WHERE id = $1", [applicationId]);
      return JSON.stringify(result.rows[0]?.form_data ?? {});
    },
    async lookup_code_attributions(args) {
      const documentId = positiveInteger(args.document_id);
      const reference = text(args.article_number, 100);
      const scope = typeof args.scope === "string" ? args.scope : "";
      const report = await inspectAttributions(documentId, reference, scope);
      const mapping = report.verified ? await lookupVerifiedAttributions(documentId, reference, scope) : null;
      return JSON.stringify({ ...report, mapping, message: "Candidates are not verified mappings. Select an exact reference and scope. Cross-edition intent requires explicit compatibility review." });
    },
    async propose_code_article(args) {
      const row = rowNumber(args.row);
      const documentId = positiveInteger(args.document_id);
      const article = text(args.article_number, 100);
      const scope = typeof args.scope === "string" ? args.scope : "";
      const rank = rowNumber(args.rank);
      const relevance = text(args.relevance, 3000);
      const benchmark = text(args.benchmark, 1500);
      const mapping = await lookupVerifiedAttributions(documentId, article, scope);
      if (!mapping) throw new Error("No complete verified mapping exists. Do not invent attribution values. Explain the missing source review.");
      return saveSuggestion(`sectionC.article${row}`, mapping.reference, `Rank ${rank}. ${relevance} Benchmark: ${benchmark}`,
        { kind: "verified_article", row, documentId, scope: mapping.scope, referenceLevel: mapping.reference_level, rank, relevance, benchmark, citations: mapping.citations, mappingFingerprint: attributionFingerprint(mapping), mapping: { code: [mapping.title, mapping.edition, mapping.jurisdiction].filter(Boolean).join(" · "), objective: mapping.objective, function: mapping.function, intent: mapping.intent } });
    },
    async recommend_supporting_document(args) {
      const row = rowNumber(args.row);
      const title = text(args.title, 200);
      const technicalIssues = text(args.technical_issues, 3000);
      const codeReferences = text(args.code_references, 2000);
      const professionalRole = text(args.professional_role, 500);
      const engineeringRationale = text(args.engineering_rationale, 2000);
      const source = text(args.source, 2000);
      if (!["potential_engineering", "professional_review_needed", "not_assessed"].includes(String(args.engineering_assessment))) throw new Error("Invalid professional involvement assessment.");
      return saveSuggestion(`sectionD.document${row}`, title, `${technicalIssues} Professional involvement: ${professionalRole}. ${engineeringRationale}`,
        { kind: "supporting_document", row, technicalIssues, codeReferences, professionalRole, engineeringAssessment: args.engineering_assessment, engineeringRationale, source });
    },
    async suggest_form_value(args) {
      if (!isFormFieldKey(args.field_key) || !AGENT_FIELD_KEYS.includes(args.field_key)) throw new Error("This field requires user entry or a verified attribution proposal.");
      const value = text(args.value, 5000);
      validateFieldValue(args.field_key, value);
      return saveSuggestion(args.field_key, value, text(args.explanation, 5000));
    },
  };
  return async (name: string, args: unknown): Promise<ToolOutput> => {
    signal?.throwIfAborted();
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid tool arguments.");
    if (!Object.hasOwn(handlers, name)) throw new Error(`Unknown tool: ${name}`);
    return handlers[name](args as Record<string, unknown>);
  };
}
