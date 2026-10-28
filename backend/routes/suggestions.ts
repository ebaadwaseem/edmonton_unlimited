import { Router } from "express";
import { db } from "../db.ts";
import { parseId } from "../http.ts";
import { FORM_FIELD_KEYS } from "../../shared/form-fields.ts";

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
    SELECT id, field_key, suggested_value, explanation, status, created_at
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

            // The CTE updates the suggestion and form together in one
            // PostgreSQL statement.
            const result = await db.query(
                `
    WITH accepted AS (
      UPDATE form_suggestions
      SET status = 'accepted'
      WHERE id = $1
        AND application_id = $2
        AND status = 'pending'
        AND field_key = ANY($3::text[])
      RETURNING *
    ),
    updated_application AS (
      UPDATE applications AS a
      SET form_data = jsonb_set(
            a.form_data,
            ARRAY[split_part(s.field_key, '.', 1)],
            COALESCE(
              a.form_data -> split_part(s.field_key, '.', 1),
              '{}'::jsonb
            ) || jsonb_build_object(
              split_part(s.field_key, '.', 2),
              s.suggested_value
            ),
            true
          ),
          updated_at = NOW()
      FROM accepted AS s
      WHERE a.id = s.application_id
      RETURNING a.id, a.form_data, a.updated_at
    )
    SELECT
      row_to_json(accepted) AS suggestion,
      row_to_json(updated_application) AS application
    FROM accepted
    JOIN updated_application
      ON updated_application.id = accepted.application_id
    `,
                [suggestionId, applicationId, FORM_FIELD_KEYS]
            );

            if (result.rows.length === 0) {
                response.status(404).json({
                    error: "Pending suggestion not found or field is unsupported.",
                });
                return;
            }

            response.json(result.rows[0]);
        } catch (error) {
            console.error("Could not review suggestion:", error);

            response.status(500).json({
                error: "Could not review suggestion.",
            });
        }
    }
);

