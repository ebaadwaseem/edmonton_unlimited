import { Router } from "express";
import { db } from "../db.ts";
import { inspectAttributions } from "../attributions.ts";
import { parseId } from "../http.ts";
export const router = Router();
router.get("/api/attributions/documents", async (_request, response) => {
  response.json((await db.query("SELECT id, title, edition, jurisdiction FROM documents WHERE reference_role = 'code' ORDER BY title")).rows);
});
router.get("/api/attributions", async (request, response) => {
  const id = parseId(String(request.query.documentId ?? ""));
  const reference = request.query.reference;
  const scope = request.query.scope ?? "";
  if (id === null || typeof reference !== "string" || typeof scope !== "string" || reference.length > 100 || scope.length > 1000) {
    response.status(400).json({ error: "Select a code document and exact provision reference and scope." }); return;
  }
  try { response.json(await inspectAttributions(id, reference, scope)); }
  catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Could not inspect attribution." }); }
});
