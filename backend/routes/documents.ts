import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "../db.ts";
import { parseId } from "../http.ts";
import multer from "multer";
import { basename } from "node:path";
import { PDFDocument } from "pdf-lib";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

export const router = Router();
// Upload a project PDF to an application.
router.post(
    "/api/applications/:id/documents",
    upload.single("file"),
    async (request, response) => {
        try {
            const applicationId = parseId(request.params.id);
            const file = request.file;

            if (applicationId === null) {
                response.status(400).json({
                    error: "Invalid application ID.",
                });
                return;
            }

            if (!file) {
                response.status(400).json({
                    error: "Please provide a PDF in the file field.",
                });
                return;
            }

            // Check the file signature instead of trusting the filename alone.
            const signature = file.buffer.subarray(0, 5).toString("ascii");

            if (signature !== "%PDF-") {
                response.status(400).json({
                    error: "The uploaded file is not recognized as a PDF.",
                });
                return;
            }

            let pageCount: number;
            try {
                pageCount = (await PDFDocument.load(file.buffer)).getPageCount();
                if (pageCount < 1) throw new Error("Empty PDF");
            } catch {
                response.status(400).json({ error: "The PDF is invalid or encrypted." });
                return;
            }
            const filename = basename(file.originalname);

            const client = await db.connect();
            try {
            await client.query("BEGIN");
            const application = await client.query("SELECT id FROM applications WHERE id=$1 FOR UPDATE", [applicationId]);
            if (!application.rows.length) {
                await client.query("ROLLBACK"); response.status(404).json({ error: "Application not found." }); return;
            }
            const result = await client.query(
                `
    INSERT INTO application_documents (
      application_id,
      original_filename,
      file_bytes,
      page_count
    )
    VALUES ($1, $2, $3, $4)
    RETURNING id, application_id, original_filename, uploaded_at
    `,
                [applicationId, filename, file.buffer, pageCount]
            );

            await client.query("UPDATE applications SET updated_at=NOW() WHERE id=$1", [applicationId]);
            await client.query("COMMIT");
            response.status(201).json(result.rows[0]);
            } catch (error) { await client.query("ROLLBACK"); throw error; }
            finally { client.release(); }
        } catch (error) {
            console.error("Could not upload document:", error);

            response.status(500).json({
                error: "Could not upload document.",
            });
        }
    }
);

// List project PDFs belonging to an application.
router.get(
    "/api/applications/:id/documents",
    async (request, response) => {
        try {
            const applicationId = parseId(request.params.id);

            if (applicationId === null) {
                response.status(400).json({
                    error: "Invalid application ID.",
                });
                return;
            }

            const result = await db.query(
                `
    SELECT id, application_id, original_filename, uploaded_at
    FROM application_documents
    WHERE application_id = $1
    ORDER BY id
    `,
                [applicationId]
            );

            response.json(result.rows);
        } catch (error) {
            console.error("Could not list documents:", error);

            response.status(500).json({
                error: "Could not list documents.",
            });
        }
    }
);

// Both IDs are required: a document cannot be read through another application's URL.
// Demo ownership is enforced by application-level authorization middleware.
export async function getApplicationDocument(request: Request, response: Response) {
    const applicationId = parseId(request.params.id);
    const documentId = parseId(request.params.documentId);
    if (applicationId === null || documentId === null) {
        response.status(400).json({ error: "Invalid application or document ID." });
        return;
    }
    const result = await db.query(
        `SELECT file_bytes FROM application_documents WHERE id = $1 AND application_id = $2`,
        [documentId, applicationId]
    );
    if (!result.rows.length) {
        response.status(404).json({ error: "Document not found in this application." });
        return;
    }
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `inline; filename="document-${documentId}.pdf"`);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(result.rows[0].file_bytes);
}

router.get("/api/applications/:id/documents/:documentId/pdf", getApplicationDocument);
