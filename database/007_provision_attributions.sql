BEGIN;
ALTER TABLE documents ADD COLUMN reference_role TEXT NOT NULL DEFAULT 'unknown'
  CHECK (reference_role IN ('unknown', 'code', 'intent_supplement'));

-- Legacy article-only tables remain intact as history, but are not used by the
-- provision lookup. A reviewed article cannot imply review of every clause.
CREATE TABLE code_provisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documents(id),
  article_number TEXT NOT NULL,
  reference TEXT NOT NULL,
  reference_level TEXT NOT NULL CHECK (reference_level IN ('article','sentence','clause','subclause','text_span')),
  scope TEXT NOT NULL DEFAULT '',
  pdf_page_start INTEGER NOT NULL CHECK (pdf_page_start > 0),
  pdf_page_end INTEGER NOT NULL CHECK (pdf_page_end >= pdf_page_start),
  document_sha256 TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'needs_review' CHECK (verification_status IN ('needs_review','verified','rejected')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_basis TEXT,
  UNIQUE(document_id, reference, scope)
);
CREATE TABLE provision_attributions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provision_id BIGINT NOT NULL REFERENCES code_provisions(id),
  kind TEXT NOT NULL CHECK (kind IN ('objective_functional','intent')),
  objective_ids TEXT[] NOT NULL DEFAULT '{}',
  functional_ids TEXT[] NOT NULL DEFAULT '{}',
  attribution_group TEXT NOT NULL DEFAULT '',
  statement_label TEXT NOT NULL DEFAULT '',
  statement_text TEXT NOT NULL,
  source_document_id BIGINT NOT NULL REFERENCES documents(id),
  source_reference TEXT NOT NULL,
  source_scope TEXT NOT NULL DEFAULT '',
  source_pdf_page_start INTEGER NOT NULL CHECK (source_pdf_page_start > 0),
  source_pdf_page_end INTEGER NOT NULL CHECK (source_pdf_page_end >= source_pdf_page_start),
  source_sha256 TEXT NOT NULL,
  source_excerpt TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'needs_review' CHECK (verification_status IN ('needs_review','verified','rejected')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_basis TEXT,
  compatibility_status TEXT NOT NULL DEFAULT 'unverified' CHECK (compatibility_status IN ('unverified','verified','incompatible')),
  compatibility_basis TEXT,
  compatibility_reviewed_by TEXT,
  compatibility_reviewed_at TIMESTAMPTZ,
  candidate_fingerprint TEXT NOT NULL,
  UNIQUE(provision_id, candidate_fingerprint)
);
CREATE TABLE attribution_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provision_id BIGINT NOT NULL REFERENCES code_provisions(id),
  review_record JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
