# Development notes

Detailed implementation notes preserved from the original README. For current
setup instructions, see [the project README](../README.md).


A local React workspace and Express backend for preparing variance applications,
reviewing agent suggestions, and previewing a fillable PDF draft. Local demo role access;
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
The source file is never written by the preview route. Preview/export PDFs remain
fillable and contain only pages 1–2 (Part 1).
Template help widgets are hidden instead of deleted to preserve tagged-PDF references.

To add a supported text field, extend `FORM_FIELDS` with its application path,
PDF text field name, and attention label. Current paths have two segments,
matching the shared form-path helper (`applicant.ownerName`, for example).
Marker pages and rectangles come from actual widgets, including crop origins and
90-degree page rotations.

## Documents and checks

- Import reference PDFs: `npm run db:import`.
- Index one imported document: `npm run db:index -- <document-id>`.
  Indexing uses one `pdftotext` process and a transactional bulk upsert; it rejects
  page-count mismatches before altering the existing index.
- `npm test`: offline regression checks for session continuation, tool replay,
  interrupted turns, template values/appearances, marker geometry, scoped document
  retrieval, and serialized tool-result size limits. Route tests mock PostgreSQL.
- `npm run build`: frontend and backend TypeScript checks, then frontend bundle.
- `npm run lint`: lint project source.

Chat admits one active turn per application, using a database advisory lock, and
up to four concurrent turns per backend process to leave pool capacity for tools.
Session IDs are saved as soon as received, including turns that later fail.
Disconnected streams reconnect up to three times within a five-minute turn limit.
Recovery checks the saved turn status, restores completed answers from saved items,
and handles pending function calls without resending the user message or repeating
completed tool calls. Turns still interrupted after recovery receive a cancellation
request; a subsequent message is sent only when the saved remote session is idle.
A terminally failed remote session requires a new application. Failed user messages
stay visible after refresh.

Full-text search uses the GIN index first, with an escaped literal fallback when
there are no matches. Results contain excerpts; the agent can inspect original
pages for details. Upload page counts are stored at upload, with lazy backfill for
older uploads.

Part 1 now has 50 mapped text/date/checkbox controls, including all Section C/D
table rows and signature dates/printed names. Digital signing remains external.
Section C automated filling requires externally reviewed attribution data. Agent
suggestions require review before updating confirmed form data. A successful agent
response does not establish code compliance. The older standalone vision experiment
is retained in `scripts/experiments/test-pdf-vision.ts` and is not used by the app.

## Workspace and PDF previews

The desktop workspace gives most of its width to the conversation and variance
draft. Project documents start collapsed in a slim left rail and open in a floating
drawer, keeping the main panels at full width. The document drawer preserves its
selected PDF and scroll position when closed. All three views scroll independently. The message composer stays at the bottom of
the conversation panel. At widths of 1150px and below, keyboard-accessible tabs
switch between the same mounted panels. A document selector lets users preview
any uploaded PDF; both PDF panels use the same canvas renderer, fit-to-width or
zoom controls, and retry states. Suggestions stay in the conversation, with a
shortcut to review them. Highlights indicate supported fields that may be filled
where applicable; they do not establish which fields are mandatory.

`GET /api/applications/:id/documents/:documentId/pdf` returns original uploaded PDF
bytes only when the document belongs to that application. It returns 400 for invalid
IDs and 404 for a missing or mismatched document. Responses disable caching. This
matches the existing localhost prototype; local demo applicant/reviewer sessions now protect the API; see `docs/reviewer-demo.md`.
No database migration is needed for this route or layout change.

For the reported 1,048,576-byte durable tool-result error, page image data URLs now
stay below 700 KiB, with progressively smaller renderings when needed. The complete
serialized result is checked in UTF-8 against a 900 KiB budget before submission,
reserving room for API metadata. Oversized results become a small tool failure so
the agent can explain the limitation or narrow its request. These conservative
budgets follow the deployed error even if other API limits are higher.

The PDF toolbar now sits outside the viewport that scrolls in both directions.
Small pale-red labels at the right end of empty variance fields (such as **Fill name**)
open a manual editing mode for all mapped text/date fields; the checkbox is also
interactive. **Edit Part 1 · A–D** opens full-size controls for all mapped fields;
users can also select **Edit fields**, then **Save** or **Discard**. Saved changes
update the form draft and PDF, and preserve other draft data. The detailed source-code
audit and next implementation steps are in `docs/variance-workflow-roadmap.md`.


## Challenge-driven Part 1 workflow

Run `npm run db:migrate` after this update (migration 006 adds suggestion metadata
and agent-configuration version tracking), then restart the backend/frontend.
The guiding challenge is `database/pdf/challange_information/Building-Codes-Challenge-with-Appendix-.pdf`.
See `docs/challenge-implementation-status.md` for requirements, implemented behavior,
known template differences, and remaining work.

Section C proposals use an exact edition/provision/scope attribution lookup. Candidate
ranking, relevance, benchmark and source evidence are retained in `sectionCEvidence`.
Unreviewed manual values are editable but are not labelled as reviewed. Section D
recommendations retain technical/professional screening context in `sectionDEvidence`;
a suggested professional role is not automatically copied into an actual responsible
person's name. Sources can be opened from the evidence view through a reference-PDF
endpoint; project uploads remain application-scoped.

Migration 007 adds exact provision references, text scopes, source fingerprints,
separate compatibility review, and review history. `npm run db:attributions -- <candidate-dataset.json>`
imports unverified candidates; `npm run db:attributions -- --review <actual-review.json>`
records a separate external review. See `docs/verified-attributions.md` and
`docs/section-c-source-investigation.md`. Five real provision examples contain 15
source candidates, all unverified; national intent compatibility remains unverified.
No source mappings have been invented or automatically marked reviewed. New tool configurations are applied to
existing applications on their next message by creating a fresh remote agent session
with the saved conversation as context. Local conversation history is retained.

Both C and D have five rows in this template. PDF fit is checked before saving or
accepting suggestions; overflow returns a field-specific 422 instead of silently
clipping text or adding pages beyond the requested two-page format.

## Applicant and Safety Codes Officer review demo

Migration 008 adds ownership, frozen submission revisions and internal reviewer notes/statuses.
Run `npm run db:migrate`, `npm run server`, and `npm run dev`. Open http://localhost:5173
and choose Applicant (password `1234`) or Safety Codes Officer / reviewer (password
`5678`). These fixed demo passwords are hardcoded in `server.ts`.
Shared demo roles are not production authentication; production startup is disabled.

Applicants can submit and resubmit frozen revisions; reviewers inspect A–D, PDFs,
original source pages, completeness findings and note history. Review complete is
an internal assessment state, never a variance decision or technical certification.
Existing unowned applications are preserved and require an explicit authorized
`npm run demo:assign -- <id>` before being visible to the shared demo applicant.

See [access, demo walkthrough, snapshot contract and limitations](reviewer-demo.md).
Run `npm run test:review` for the live fictional PostgreSQL flow (no model calls).

## Demo persistence

The fixed applicant/reviewer passwords (`1234` / `5678`) do not change on restart.
Run `npm run db:migrate` for migration 009: demo login sessions now persist in
PostgreSQL without an eight-hour timeout, with a renewable 400-day HttpOnly cookie.
Logout or clearing cookies ends the browser login. Existing browser sessions from
the previous in-memory implementation need one fresh sign-in.

Samples and all saved application/review data remain in the existing bind-mounted
PostgreSQL data directory across database/backend restarts. Applicant/reviewer lists
reload from the database, and the browser remembers the selected application.
See `docs/reviewer-demo.md` for the verified restart procedure and limits.
