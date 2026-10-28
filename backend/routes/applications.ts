import { Router } from "express";
import { db } from "../db.ts";
import { parseId } from "../http.ts";

export const router = Router();
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
    INSERT INTO applications (title, jurisdiction)
    VALUES ($1, $2)
    RETURNING *
    `,
            [title.trim(), jurisdiction?.trim() || null]
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
            `SELECT id, title, jurisdiction, form_data, created_at, updated_at FROM applications WHERE id = $1`,
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

// Save the current application form draft.
router.patch("/api/applications/:id/form", async (request, response) => {
    try {
        const id = parseId(request.params.id);
        const formData = request.body?.formData;

        if (id === null) {
            response.status(400).json({
                error: "Invalid application ID.",
            });
            return;
        }

        if (
            !formData ||
            typeof formData !== "object" ||
            Array.isArray(formData)
        ) {
            response.status(400).json({
                error: "formData must be an object.",
            });
            return;
        }

        const result = await db.query(
            `
  UPDATE applications
  SET form_data = $1::jsonb,
      updated_at = NOW()
  WHERE id = $2
  RETURNING id, title, jurisdiction, form_data, updated_at
  `,
            [JSON.stringify(formData), id]
        );

        if (result.rows.length === 0) {
            response.status(404).json({
                error: "Application not found.",
            });
            return;
        }

        response.json(result.rows[0]);
    } catch (error) {
        console.error("Could not save form:", error);

        response.status(500).json({
            error: "Could not save form.",
        });
    }
});
