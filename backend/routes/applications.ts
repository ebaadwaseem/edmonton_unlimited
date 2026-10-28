import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "../db.ts";
import { createPreview, PdfValidationError } from "../template.ts";
import { invalidateChangedEvidence } from "../../shared/part-one.ts";
import { parseId } from "../http.ts";

export const router = Router();
router.get("/api/applications", async (_request, response) => {
    response.json((await db.query("SELECT id,title,jurisdiction,workflow_status,latest_submission_id,updated_at FROM applications WHERE owner_id=$1 ORDER BY updated_at DESC,id DESC", [response.locals.principal.id])).rows);
});
// Create a new application.
router.post("/api/applications", async (request, response) => {
    try {
        const title = request.body?.title;
        const jurisdiction = request.body?.jurisdiction;

        if (typeof title !== "string" || !title.trim()) {
            response.status(400).json({
                error: "A title is required.",
            });
            return;
        }

        if (
            jurisdiction !== undefined &&
            typeof jurisdiction !== "string"
        ) {
            response.status(400).json({
                error: "Jurisdiction must be a string.",
            });
            return;
        }

        const result = await db.query(
            `
    INSERT INTO applications (title, jurisdiction, owner_id)
    VALUES ($1, $2, $3)
    RETURNING *
    `,
            [title.trim(), jurisdiction?.trim() || null, response.locals.principal.id]
        );

        response.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("Could not create application:", error);
        response.status(500).json({
            error: "Could not create application.",
        });
    }
});

// Get an application and its saved conversation.
router.get("/api/applications/:id", async (request, response) => {
    try {
        const id = parseId(request.params.id);

        if (id === null) {
            response.status(400).json({ error: "Invalid application ID." });
            return;
        }

        const application = await db.query(
            `SELECT id, title, jurisdiction, form_data, workflow_status, latest_submission_id, created_at, updated_at FROM applications WHERE id = $1`,
            [id]
        );

        if (application.rows.length === 0) {
            response.status(404).json({ error: "Application not found." });
            return;
        }

        const messages = await db.query(
            `
    SELECT id, role, content, agent_session_id, created_at
    FROM conversation_messages
    WHERE application_id = $1
    ORDER BY id
    `,
            [id]
        );

        response.json({
            application: application.rows[0],
            messages: messages.rows,
        });
    } catch (error) {
        console.error("Could not load application:", error);
        response.status(500).json({
            error: "Could not load application.",
        });
    }
});

// Save all draft values atomically, validating PDF fit before committing.
export async function saveApplicationForm(request: Request, response: Response) {
    const id = parseId(request.params.id);
    const proposed = request.body?.formData;
    if (id === null) { response.status(400).json({ error: "Invalid application ID." }); return; }
    if (!proposed || typeof proposed !== "object" || Array.isArray(proposed)) {
        response.status(400).json({ error: "formData must be an object." }); return;
    }
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        const previous = await client.query("SELECT form_data FROM applications WHERE id = $1 FOR UPDATE", [id]);
        if (!previous.rows.length) {
            await client.query("ROLLBACK"); response.status(404).json({ error: "Application not found." }); return;
        }
        const formData = invalidateChangedEvidence(previous.rows[0].form_data, proposed);
        await createPreview(formData);
        const result = await client.query(`UPDATE applications SET form_data = $1::jsonb, updated_at = NOW() WHERE id = $2
            RETURNING id, title, jurisdiction, form_data, updated_at`, [JSON.stringify(formData), id]);
        await client.query("COMMIT");
        response.json(result.rows[0]);
    } catch (error) {
        await client.query("ROLLBACK");
        if (error instanceof PdfValidationError) response.status(422).json({ error: error.message });
        else { console.error("Could not save form:", error instanceof Error ? error.message : "Unknown error"); response.status(500).json({ error: "Could not save form." }); }
    } finally { client.release(); }
}

router.patch("/api/applications/:id/form", saveApplicationForm);

export async function deleteApplicationDraft(request: Request, response: Response) {
    const id = parseId(request.params.id);
    if (id === null) { response.status(400).json({ error: "Invalid application ID." }); return; }
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        const lock = await client.query("SELECT pg_try_advisory_xact_lock($1::bigint) AS locked", [id]);
        if (!lock.rows[0].locked) {
            await client.query("ROLLBACK"); response.status(409).json({ error: "Wait for the assistant request to finish before deleting this draft." }); return;
        }
        const application = (await client.query(`SELECT a.id,a.workflow_status,a.latest_submission_id,
            EXISTS (SELECT 1 FROM application_submissions s WHERE s.application_id=a.id) AS has_submissions
            FROM applications a WHERE a.id=$1 AND a.owner_id=$2 FOR UPDATE OF a`, [id, response.locals.principal.id])).rows[0];
        if (!application) {
            await client.query("ROLLBACK"); response.status(404).json({ error: "Draft not found." }); return;
        }
        if (application.workflow_status !== "draft" || application.latest_submission_id || application.has_submissions) {
            await client.query("ROLLBACK"); response.status(409).json({ error: "Only applications that have never been submitted can be deleted. Submitted revisions and reviewer history are preserved." }); return;
        }
        // Existing foreign keys cascade only draft conversation, suggestions and uploads.
        await client.query("DELETE FROM applications WHERE id=$1 AND owner_id=$2", [id, response.locals.principal.id]);
        await client.query("COMMIT"); response.json({ id: String(id), deleted: true });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
}
router.delete("/api/applications/:id", deleteApplicationDraft);
