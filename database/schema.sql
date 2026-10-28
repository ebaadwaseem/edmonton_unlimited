BEGIN;

-- ============================================================
-- 1. Documents
-- ============================================================
-- Stores the original PDF and information identifying its source.
--
-- Examples:
-- - A building code
-- - An Alberta regulation or amendment
-- - A user guide
-- - A variance application template
-- ============================================================

CREATE TABLE documents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    title TEXT NOT NULL,

    document_type TEXT NOT NULL
        CHECK (document_type IN (
            'building_code',
            'legislation',
            'standard',
            'guide',
            'template',
            'other'
        )),

    -- These are optional because not every document has an edition
    -- or applies to one specific jurisdiction.
    jurisdiction TEXT,
    edition TEXT,

    -- Where the document came from, if known.
    publisher TEXT,
    source_url TEXT,

    original_filename TEXT NOT NULL,

    -- The original PDF file itself.
    file_bytes BYTEA NOT NULL,

    page_count INTEGER
        CHECK (page_count IS NULL OR page_count > 0),

    processing_status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK (processing_status IN (
            'uploaded',
            'processing',
            'ready',
            'needs_review',
            'failed'
        )),

    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 2. Extracted document pages
-- ============================================================
-- Each row represents one physical page in the original PDF.
--
-- Keeping page numbers means that search results can point back
-- to the original source, including its drawings and tables.
-- ============================================================

CREATE TABLE document_pages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    document_id BIGINT NOT NULL
        REFERENCES documents(id) ON DELETE CASCADE,

    -- 1 means the first physical page of the PDF.
    pdf_page_number INTEGER NOT NULL
        CHECK (pdf_page_number > 0),

    -- Optional page number printed in the document, which may
    -- differ from the physical page number.
    printed_page_label TEXT,

    -- May be NULL if text hasn't been extracted or the page is
    -- image-only.
    extracted_text TEXT,

    extraction_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (extraction_status IN (
            'pending',
            'extracted',
            'needs_review',
            'failed'
        )),

    -- Used by PostgreSQL's built-in full-text search.
    search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(extracted_text, ''))
    ) STORED,

    UNIQUE (document_id, pdf_page_number)
);


-- ============================================================
-- 3. Code articles
-- ============================================================
-- An article is associated with its source document and page
-- range. The ingestion process can add rows here after it can
-- reliably identify article boundaries.
-- ============================================================

CREATE TABLE code_articles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    document_id BIGINT NOT NULL
        REFERENCES documents(id) ON DELETE CASCADE,

    article_number TEXT NOT NULL,
    heading TEXT,
    article_text TEXT,

    pdf_page_start INTEGER
        CHECK (pdf_page_start IS NULL OR pdf_page_start > 0),

    pdf_page_end INTEGER
        CHECK (pdf_page_end IS NULL OR pdf_page_end > 0),

    extraction_status TEXT NOT NULL DEFAULT 'needs_review'
        CHECK (extraction_status IN (
            'needs_review',
            'verified'
        )),

    CHECK (
        pdf_page_start IS NULL
        OR pdf_page_end IS NULL
        OR pdf_page_end >= pdf_page_start
    ),

    UNIQUE (document_id, article_number)
);


-- ============================================================
-- 4. Article attributions
-- ============================================================
-- Stores objective, functional and intent statements associated
-- with an article for Section C of the variance application.
--
-- A statement can have a different source document from the
-- article itself, so source_document_id is stored separately.
--
-- Creating these rows does not make the mappings authoritative:
-- they must be checked against their source.
-- ============================================================

CREATE TABLE code_attributions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    article_id BIGINT NOT NULL
        REFERENCES code_articles(id) ON DELETE CASCADE,

    statement_type TEXT NOT NULL
        CHECK (statement_type IN (
            'objective',
            'functional',
            'intent'
        )),

    -- For codes such as an objective or functional statement ID.
    statement_identifier TEXT,

    statement_text TEXT NOT NULL,

    source_document_id BIGINT NOT NULL
        REFERENCES documents(id) ON DELETE RESTRICT,

    source_pdf_page INTEGER
        CHECK (source_pdf_page IS NULL OR source_pdf_page > 0),

    verification_status TEXT NOT NULL DEFAULT 'needs_review'
        CHECK (verification_status IN (
            'needs_review',
            'verified'
        )),

    verified_by TEXT,
    verified_at TIMESTAMPTZ
);


-- ============================================================
-- 5. PDF template field mappings
-- ============================================================
-- Maps your application's data to a specific PDF template.
--
-- Example:
--   field_key      = 'applicant.owner_name'
--   pdf_field_name = 'Owner Name'
--
-- For non-fillable PDFs, placement can later describe the page
-- and coordinates where text should be drawn.
-- ============================================================

CREATE TABLE template_fields (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    template_document_id BIGINT NOT NULL
        REFERENCES documents(id) ON DELETE CASCADE,

    field_key TEXT NOT NULL,

    pdf_field_name TEXT,

    -- Optional JSON for page number, coordinates, font size, etc.
    placement JSONB,

    UNIQUE (template_document_id, field_key)
);


-- ============================================================
-- Indexes
-- ============================================================

-- Makes PostgreSQL full-text searches over extracted pages faster.
CREATE INDEX document_pages_search_idx
    ON document_pages USING GIN (search_vector);

CREATE INDEX code_articles_lookup_idx
    ON code_articles (document_id, article_number);

CREATE INDEX code_attributions_article_idx
    ON code_attributions (article_id);

CREATE INDEX documents_type_idx
    ON documents (document_type);

COMMIT;