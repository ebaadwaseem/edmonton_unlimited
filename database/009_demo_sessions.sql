BEGIN;
-- Local demo sessions are durable and have no server-side time limit.
-- Logout, role switching, or changing the configured role password revokes access.
CREATE TABLE demo_sessions (
  token_hash TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('applicant','reviewer')),
  credential_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
