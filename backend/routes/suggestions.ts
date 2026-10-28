import { Router } from "express";
import { db } from "../db.ts";
import { parseId } from "../http.ts";
import { acceptSuggestedValue } from "../suggestion-values.ts";
import { createPreview, PdfValidationError } from "../template.ts";

export const router = Router();
router.get(
    "/api/applications/:id/suggestions",
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
    SELECT id, field_key, suggested_value, explanation, metadata, status, created_at
    FROM form_suggestions
    WHERE application_id = $1
    ORDER BY id
    `,
                [applicationId]
            );

            response.json(result.rows);
        } catch (error) {
            console.error("Could not load suggestions:", error);

            response.status(500).json({
                error: "Could not load suggestions.",
            });
        }
    }
);

router.post(
    "/api/applications/:id/suggestions/:suggestionId/review",
    async (request, response) => {
        try {
            const applicationId = parseId(request.params.id);
            const suggestionId = parseId(
                request.params.suggestionId
            );
            const action = request.body?.action;

            if (applicationId === null || suggestionId === null) {
                response.status(400).json({
                    error: "Invalid application or suggestion ID.",
                });
                return;
            }

            if (action !== "accept" && action !== "reject") {
                response.status(400).json({
                    error: 'Action must be "accept" or "reject".',
                });
                return;
            }

            if (action === "reject") {
                const result = await db.query(
                    `
      UPDATE form_suggestions
      SET status = 'rejected'
      WHERE id = $1
        AND application_id = $2
        AND status = 'pending'
      RETURNING *
      `,
                    [suggestionId, applicationId]
                );

                if (result.rows.length === 0) {
                    response.status(404).json({
                        error: "Pending suggestion not found.",
                    });
                    return;
                }

                response.json({
                    suggestion: result.rows[0],
                });

                return;
            }

            const client = await db.connect();
            try {
                await client.query("BEGIN");
                const application = await client.query("SELECT id, form_data FROM applications WHERE id = $1 FOR UPDATE", [applicationId]);
                const suggestion = await client.query("SELECT * FROM form_suggestions WHERE id = $1 AND application_id = $2 AND status = 'pending' FOR UPDATE", [suggestionId, applicationId]);
                if (!application.rows.length || !suggestion.rows.length) {
                    await client.query("ROLLBACK");
                    response.status(404).json({ error: "Pending suggestion not found." }); return;
                }
                const formData = await acceptSuggestedValue(application.rows[0].form_data, suggestion.rows[0]);
                await createPreview(formData); // Reject overflow before saving any part of the suggestion.
                const updated = await client.query("UPDATE applications SET form_data = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING id, form_data, updated_at", [JSON.stringify(formData), applicationId]);
                const accepted = await client.query("UPDATE form_suggestions SET status = 'accepted' WHERE id = $1 RETURNING *", [suggestionId]);
                await client.query("COMMIT");
                response.json({ suggestion: accepted.rows[0], application: updated.rows[0] });
            } catch (error) {
                await client.query("ROLLBACK");
                response.status(error instanceof PdfValidationError ? 422 : 409).json({ error: error instanceof Error ? error.message : "Could not accept suggestion." });
            } finally { client.release(); }
        } catch (error) {
            console.error("Could not review suggestion:", error);

            response.status(500).json({
                error: "Could not review suggestion.",
            });
        }
    }
);

