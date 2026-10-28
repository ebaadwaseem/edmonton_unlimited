import { Router } from "express";
import { db } from "../db.ts";
import { parseId } from "../http.ts";
import { createPreview, loadFormMarkers, PdfValidationError } from "../template.ts";

export const router = Router();
router.get("/api/template/fields", async (_request, response) => {
  response.json(await loadFormMarkers());
});
router.get("/api/applications/:id/preview.pdf", async (request, response) => {
  const id = parseId(request.params.id);
  if (id === null) { response.status(400).json({ error: "Invalid application ID." }); return; }
  const result = await db.query("SELECT form_data FROM applications WHERE id = $1", [id]);
  if (!result.rows.length) { response.status(404).json({ error: "Application not found." }); return; }
  let bytes: Uint8Array;
  try { bytes = await createPreview(result.rows[0].form_data); }
  catch (error) {
    if (error instanceof PdfValidationError) { response.status(422).json({ error: error.message }); return; }
    throw error;
  }
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Disposition", `inline; filename="application-${id}-draft.pdf"`);
  response.send(Buffer.from(bytes));
});

// Reference sources are shared by all local applications, unlike project uploads.
router.get("/api/reference-documents/:id/pdf", async (request, response) => {
  const id = parseId(request.params.id);
  if (id === null) { response.status(400).json({ error: "Invalid reference document ID." }); return; }
  const result = await db.query("SELECT file_bytes FROM documents WHERE id = $1 AND document_type <> 'template'", [id]);
  if (!result.rows.length) { response.status(404).json({ error: "Reference document not found." }); return; }
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.send(result.rows[0].file_bytes);
});
