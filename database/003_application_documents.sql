BEGIN;

CREATE TABLE IF NOT EXISTS application_documents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    application_id BIGINT NOT NULL
        REFERENCES applications(id) ON DELETE CASCADE,

    original_filename TEXT NOT NULL,
    file_bytes BYTEA NOT NULL,

    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS application_documents_application_idx
    ON application_documents (application_id);

COMMIT;