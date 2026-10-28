# Variance application prototype

A local React workspace and Express backend for preparing variance applications,
reviewing agent suggestions, and previewing a fillable PDF draft. No authentication;
keep the backend bound to localhost.

## Run locally

Requires Node.js, npm, Docker Compose, and Poppler (`pdftoppm`, `pdftotext`, `pdfinfo`).
On macOS, install Poppler with `brew install poppler`.

1. Install dependencies with `npm install`.
2. Set `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `OPENAI_API_KEY` in `.env`.
3. Start PostgreSQL: `docker compose up -d db`.
4. Apply migrations: `npm run db:migrate`. Run this before starting the refactored backend.
5. Start the backend: `npm run server`.
6. In a second terminal: `npm run dev`.

Compose mounts `database/postgres/` as the live PostgreSQL data directory. Do not
edit, delete, or re-import files in that directory. The migration command adopts
an existing baseline, applies the idempotent application migrations, and records
completed migrations. It does not reset existing tables. Migration 005 saves agent
session IDs on applications, adds cached upload page counts, and retains only the
newest pending suggestion per field (older suggestions remain as rejected history).

## Structure

- `server.ts`: localhost listener and shutdown.
- `backend/app.ts`, `backend/routes/`: API configuration and application, upload,
  message, suggestion, and PDF routes.
- `backend/db.ts`: shared PostgreSQL pool. `backend/pg.d.ts` describes the small
  subset of `pg` APIs used by the prototype, without requiring `@types/pg`.
- `backend/agent/`: agent configuration, validated tool handlers, asynchronous PDF
  rendering, and session turn lifecycle. The server calls the module directly.
- `shared/form-fields.ts`: supported application keys, PDF field names, and labels.
- `backend/template.ts`: cached original template bytes, fresh per-request PDF
  documents, filling, appearance updates, and widget-based marker geometry.
- `src/VarianceWorkspace.tsx`: application workflow. `VariancePreview.tsx` loads the
  PDF viewer on demand when an application is opened.

The template at `database/pdf/templates/Variance_Template.pdf` is the source of
truth for previews; a database document ID is no longer required. Restart the
backend after replacing this file to refresh the in-memory byte/geometry caches.
The source file is never written by the preview route. Preview PDFs remain fillable.
Template help widgets are hidden instead of deleted to preserve tagged-PDF references.

To add a supported text field, extend `FORM_FIELDS` with its application path,
PDF text field name, and attention label. Current paths have two segments,
matching the suggestion-acceptance SQL (`applicant.ownerName`, for example).
Marker pages and rectangles come from actual widgets, including crop origins and
90-degree page rotations.

## Documents and checks

- Import reference PDFs: `npm run db:import`.
- Index one imported document: `npm run db:index -- <document-id>`.
  Indexing uses one `pdftotext` process and a transactional bulk upsert; it rejects
  page-count mismatches before altering the existing index.
- `npm test`: offline regression checks for session continuation, tool replay,
  interrupted turns, template values/appearances, and marker geometry.
- `npm run build`: frontend and backend TypeScript checks, then frontend bundle.
- `npm run lint`: lint project source.

Chat admits one active turn per application, using a database advisory lock, and
up to four concurrent turns per backend process to leave pool capacity for tools.
Session IDs are saved as soon as received, including turns that later fail.
Interrupted turns receive a cancellation request; a subsequent message is sent
only when the saved remote session is idle. A terminally failed remote session
requires a new application. Failed user messages stay visible after refresh.

Full-text search uses the GIN index first, with an escaped literal fallback when
there are no matches. Results contain excerpts; the agent can inspect original
pages for details. Upload page counts are stored at upload, with lazy backfill for
older uploads.

Section C, signatures, and broader PDF field coverage remain incomplete. Agent
suggestions require review before updating confirmed form data. A successful agent
response does not establish code compliance. The older standalone vision experiment
is retained in `scripts/test-pdf-vision.ts` and is not used by the app.
