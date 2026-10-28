import { PDFDocument } from "pdf-lib";
import { db } from "../db.ts";
import { isFormFieldKey } from "../../shared/form-fields.ts";
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
    async suggest_form_value(args) {
      if (!isFormFieldKey(args.field_key)) throw new Error("Unsupported form field.");
      const value = text(args.value, 5000);
      const explanation = text(args.explanation, 5000);
      signal?.throwIfAborted();
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        // Serialize replacements for this application, including callers outside chat.
        await client.query("SELECT id FROM applications WHERE id = $1 FOR UPDATE", [applicationId]);
        await client.query(`UPDATE form_suggestions SET status = 'rejected'
          WHERE application_id = $1 AND field_key = $2 AND status = 'pending'`, [applicationId, args.field_key]);
        const result = await client.query(`INSERT INTO form_suggestions
          (application_id, field_key, suggested_value, explanation) VALUES ($1, $2, $3, $4)
          RETURNING id, field_key, suggested_value, explanation, status`, [applicationId, args.field_key, value, explanation]);
        signal?.throwIfAborted();
        await client.query("COMMIT");
        return JSON.stringify(result.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
  };
  return async (name: string, args: unknown): Promise<ToolOutput> => {
    signal?.throwIfAborted();
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid tool arguments.");
    if (!Object.hasOwn(handlers, name)) throw new Error(`Unknown tool: ${name}`);
    return handlers[name](args as Record<string, unknown>);
  };
}
