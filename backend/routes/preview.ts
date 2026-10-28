import { Router } from "express";
import { db } from "../db.ts";
import { parseId } from "../http.ts";
import { createPreview, loadFormMarkers } from "../template.ts";

export const router = Router();
router.get("/api/template/fields", async (_request, response) => {
  response.json(await loadFormMarkers());
});
router.get("/api/applications/:id/preview.pdf", async (request, response) => {
  const id = parseId(request.params.id);
  if (id === null) { response.status(400).json({ error: "Invalid application ID." }); return; }
  const result = await db.query("SELECT form_data FROM applications WHERE id = $1", [id]);
  if (!result.rows.length) { response.status(404).json({ error: "Application not found." }); return; }
  const bytes = await createPreview(result.rows[0].form_data);
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Disposition", `inline; filename="application-${id}-draft.pdf"`);
  response.send(Buffer.from(bytes));
});
