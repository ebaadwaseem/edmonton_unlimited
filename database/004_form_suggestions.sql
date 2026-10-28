BEGIN;

CREATE TABLE IF NOT EXISTS form_suggestions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    application_id BIGINT NOT NULL
        REFERENCES applications(id) ON DELETE CASCADE,

    field_key TEXT NOT NULL,
    suggested_value TEXT NOT NULL,

    -- Why the agent suggested the value.
    explanation TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS form_suggestions_application_idx
    ON form_suggestions (application_id, id);

COMMIT;