BEGIN;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS agent_session_id TEXT;
UPDATE applications a
SET agent_session_id = (
  SELECT m.agent_session_id FROM conversation_messages m
  WHERE m.application_id = a.id AND m.agent_session_id IS NOT NULL
    AND m.role = 'assistant'
  ORDER BY m.id DESC LIMIT 1
)
WHERE a.agent_session_id IS NULL;

ALTER TABLE application_documents ADD COLUMN IF NOT EXISTS page_count INTEGER
  CHECK (page_count IS NULL OR page_count > 0);

-- Keep the newest pending proposal per field; preserve the older rows for history.
UPDATE form_suggestions s SET status = 'rejected'
WHERE s.status = 'pending' AND EXISTS (
  SELECT 1 FROM form_suggestions newer
  WHERE newer.application_id = s.application_id AND newer.field_key = s.field_key
    AND newer.status = 'pending' AND newer.id > s.id
);
CREATE UNIQUE INDEX IF NOT EXISTS form_suggestions_pending_field_idx
  ON form_suggestions (application_id, field_key) WHERE status = 'pending';

-- The UNIQUE constraint already provides this index.
DROP INDEX IF EXISTS code_articles_lookup_idx;

COMMIT;
