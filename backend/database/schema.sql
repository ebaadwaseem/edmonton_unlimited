-- Adds vector support to this database.
CREATE EXTENSION IF NOT EXISTS vector;

-- Original reference documents and variance templates.
CREATE TABLE IF NOT EXISTS documents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    title TEXT NOT NULL,
    document_type TEXT NOT NULL
        CHECK (document_type IN ('reference', 'template')),

    jurisdiction TEXT,
    edition TEXT,

    original_filename TEXT NOT NULL,
    file_bytes BYTEA NOT NULL,

    status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK (status IN (
            'uploaded',
            'processing',
            'ready',
            'needs_review',
            'failed'
        )),

    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Searchable pieces extracted from reference documents.
CREATE TABLE IF NOT EXISTS document_chunks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    document_id BIGINT NOT NULL
        REFERENCES documents(id) ON DELETE CASCADE,

    chunk_number INTEGER NOT NULL,
    content TEXT NOT NULL,

    page_start INTEGER,
    page_end INTEGER,
    article_number TEXT,

    -- Matches OpenAI text-embedding-3-small's default dimensions.
    embedding VECTOR(1536),

    UNIQUE (document_id, chunk_number)
);

-- Exact mappings for Section C, once extracted and verified.
CREATE TABLE IF NOT EXISTS code_attributions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    document_id BIGINT NOT NULL
        REFERENCES documents(id) ON DELETE CASCADE,

    article_number TEXT NOT NULL,
    objective_statement TEXT,
    functional_statement TEXT,
    intent_statement TEXT,

    source_page INTEGER,
    verification_status TEXT NOT NULL DEFAULT 'needs_review'
        CHECK (verification_status IN ('needs_review', 'verified'))
);

-- Maps application data to a particular jurisdiction's PDF template.
CREATE TABLE IF NOT EXISTS template_fields (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    template_document_id BIGINT NOT NULL
        REFERENCES documents(id) ON DELETE CASCADE,

    -- Example: applicant.name
    field_key TEXT NOT NULL,

    -- Populated when the PDF contains a matching fillable field.
    pdf_field_name TEXT,

    -- Can later hold page/position details for non-fillable PDFs.
    placement JSONB,

    UNIQUE (template_document_id, field_key)
);

CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx
    ON document_chunks (document_id);

CREATE INDEX IF NOT EXISTS code_attributions_lookup_idx
    ON code_attributions (document_id, article_number);