BEGIN;
ALTER TABLE applications ADD COLUMN owner_id TEXT;
ALTER TABLE applications ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'draft'
  CHECK (workflow_status IN ('draft','submitted','changes_requested','review_complete'));
ALTER TABLE applications ADD COLUMN latest_submission_id BIGINT;
CREATE TABLE application_submissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  snapshot JSONB NOT NULL,
  preview_bytes BYTEA NOT NULL,
  submitted_by TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','changes_requested','review_complete')),
  status_updated_by TEXT,
  status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(application_id, revision)
);
ALTER TABLE applications ADD CONSTRAINT applications_latest_submission_fk FOREIGN KEY (latest_submission_id) REFERENCES application_submissions(id);
CREATE TABLE submission_documents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES application_submissions(id),
  original_document_id BIGINT NOT NULL,
  original_filename TEXT NOT NULL,
  page_count INTEGER,
  uploaded_at TIMESTAMPTZ NOT NULL,
  file_bytes BYTEA NOT NULL,
  UNIQUE(submission_id,original_document_id)
);
CREATE TABLE submission_references (
  submission_id BIGINT NOT NULL REFERENCES application_submissions(id),
  original_document_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  edition TEXT,
  jurisdiction TEXT,
  page_count INTEGER,
  sha256 TEXT NOT NULL,
  file_bytes BYTEA NOT NULL,
  PRIMARY KEY(submission_id,original_document_id)
);
CREATE TABLE submission_findings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES application_submissions(id),
  finding_key TEXT NOT NULL,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('missing','needs_clarification','unverified','provided','not_applicable')),
  detail TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed','reviewed','needs_clarification')),
  reviewed_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(submission_id,finding_key)
);
CREATE TABLE submission_review_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES application_submissions(id),
  finding_id BIGINT REFERENCES submission_findings(id),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX submissions_queue_idx ON application_submissions(status,submitted_at DESC);
CREATE INDEX review_events_submission_idx ON submission_review_events(submission_id,id);
COMMIT;
