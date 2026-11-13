# Building Code Variance Assistant

A prototype built for the Edmonton Unlimited Building Codes Challenge. It helps
applicants prepare Part 1 (Sections A–D) of an Alberta safety codes variance
application, find supporting code references, and export a fillable two-page PDF.
Reviewers can inspect submitted revisions, record findings, and request changes.

AI suggestions require applicant review before changing the draft. The project
supports application preparation and administrative review; it does not approve
variances or certify code compliance.

## Stack

- **Frontend:** React, TypeScript, Vite, and React-PDF.
- **Backend:** Node.js, Express, and the OpenAI SDK for agent sessions and tools.
- **Database:** PostgreSQL 17 with built-in full-text search, run through Docker Compose.
- **PDF processing:** Poppler for text extraction/page rendering and pdf-lib for form filling.

## Run locally

Requires Node.js 24 or newer, npm, Docker with Compose, and Poppler
(`pdfinfo`, `pdftotext`, `pdftoppm`). On macOS: `brew install poppler`.
Agent chat requires an OpenAI API key with access to the model and agent-session
API used in [the agent configuration](backend/agent/config.ts) and
[turn runner](backend/agent/run-turn.ts).

From the project root:

```sh
npm ci
cp .env.example .env
# Edit .env: choose a local database password and add your OpenAI API key.
docker compose up -d db
# Wait for PostgreSQL to be ready before migrating.
npm run db:migrate
```

For code-reference search, import and index the PDFs as described below. Then
start the backend and frontend in separate terminals:

```sh
npm run server
```

```sh
npm run dev
```

Open **http://localhost:5173**. Demo passcodes: **Applicant `1234`** and
**Reviewer `5678`**. The API listens at `127.0.0.1:3001`.

These are shared local demo roles. Production startup is deliberately blocked.
PostgreSQL data persists in `database/postgres/`; keep it out of Git and do not
delete it when cleaning the source tree. PDF previews require
`database/pdf/templates/Variance_Template.pdf`.

## Making reference documents readable by the agent

The retrieval pipeline uses PostgreSQL full-text search and original PDF pages:

1. Put reference PDFs under `database/pdf/`, then run `npm run db:import`.
   [import-documents.ts](scripts/import-documents.ts) stores the original bytes,
   document type, and page count in `documents`, skipping byte-identical files.
   Only files with a `.pdf` extension are imported.
2. For each imported document ID printed by the importer, run
   `npm run db:index -- <document-id>`.
   [index-document.ts](scripts/index-document.ts) uses `pdftotext -layout` to
   extract individual pages into `document_pages`, retaining physical page numbers.
   PostgreSQL generates searchable text vectors with a GIN index.
3. At runtime, [agent tools](backend/agent/tools.ts) search those pages and return
   excerpts with document/page references. The agent can also inspect an original
   page rendered by [render-page.ts](backend/agent/render-page.ts) when it needs
   tables, diagrams, or visual details. Uploaded project PDFs are inspected through
   separate tools scoped to the current application.

[import-verified-attributions.ts](scripts/import-verified-attributions.ts), exposed
as `npm run db:attributions -- <dataset.json>`, imports structured provision
attribution candidates. Verification requires a separate external review;
importing candidates does not verify them. See [attribution setup and review](docs/verified-attributions.md).
The supplied candidate dataset uses document IDs and byte hashes from the original
database; check those against your import before using it on a fresh database.

## Project structure

```text
src/                    React applicant and reviewer workspaces
backend/
  routes/               Application, document, chat, review, and PDF APIs
  agent/                Agent instructions, tool handlers, and turn lifecycle
shared/                 Shared form fields, types, and validation
database/               SQL schema, migrations, and attribution candidates
  pdf/                  Reference PDFs and the fillable variance template
scripts/                Database setup, import/index, and demo utilities
  experiments/          Standalone PDF vision experiment
tests/                  Regression tests and optional database integration checks
docs/                   Workflow, source investigation, and development notes
server.ts               API entry point
compose.yaml            Local PostgreSQL service
```

## Checks and further reading

```sh
npm test                # Offline tests; .env database values are still required
npm run lint
npm run build           # TypeScript checks and frontend build
```

See the [reviewer walkthrough](docs/reviewer-demo.md),
[implementation notes](docs/development-notes.md), and
[public release checklist](docs/public-release.md).
