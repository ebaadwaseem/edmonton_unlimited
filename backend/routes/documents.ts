import { Router } from "express";
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

            const application = await db.query(
                `SELECT id FROM applications WHERE id = $1`,
                [applicationId]
            );

            if (application.rows.length === 0) {
                response.status(404).json({
                    error: "Application not found.",
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

            const result = await db.query(
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

            response.status(201).json(result.rows[0]);
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

