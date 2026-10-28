BEGIN;

CREATE TABLE IF NOT EXISTS applications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    title TEXT NOT NULL,
    jurisdiction TEXT,

    -- The applicant's answers will be stored here as the form grows.
    form_data JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    application_id BIGINT NOT NULL
        REFERENCES applications(id) ON DELETE CASCADE,

    role TEXT NOT NULL
        CHECK (role IN ('user', 'assistant')),

    content TEXT NOT NULL,

    -- Filled in for agent responses when a session ID is available.
    agent_session_id TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversation_messages_application_idx
    ON conversation_messages (application_id, id);

COMMIT;