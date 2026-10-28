BEGIN;
ALTER TABLE form_suggestions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS agent_config_version TEXT;
COMMIT;
