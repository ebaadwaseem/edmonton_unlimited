# Applicant and Safety Codes Officer demo

This is an end-to-end **local administrative-review prototype**. Neither the AI nor
the internal `review_complete` state approves/refuses a variance or establishes
technical compliance. No emails, external messages or notifications are sent.

## Access both views

Existing PostgreSQL configuration stays in the server's gitignored `.env`. Then:

```sh
npm run db:migrate
npm run server
```

In another terminal:

```sh
npm run dev
```

Open http://localhost:5173. The sign-in screen offers **Applicant** and **Safety
Codes Officer / reviewer**. The fixed local-demo passwords are:

- Applicant: `1234`
- Safety Codes Officer / reviewer: `5678`

These demo passwords are hardcoded in `server.ts` and also printed in the backend
terminal. They do not change on restart. The optional comma-separated
`DEMO_ALLOWED_ORIGINS` changes the allowed frontend origins; defaults are localhost
and 127.0.0.1 on ports 5173 and 3001. An alternate Vite port needs an explicit origin.
Database credentials and the OpenAI key stay in the backend environment.
All database and model access runs on the backend. No model call is needed for
submission, deterministic completeness findings, reviewer notes or status changes.

Use **Sign out / change role** to switch. For simultaneous views, use separate
browser profiles or a private window: the same-origin session cookie belongs to
one role at a time. Demo sessions are stored in PostgreSQL with **no server-side
eight-hour expiration**. Existing sessions survive backend/watch and database
restarts. The browser gets a persistent HttpOnly cookie valid for 400 days, renewed
on authenticated requests; signing out or clearing cookies ends that browser login.
Changing a role's hardcoded password invalidates its existing sessions. Saved data
remains in PostgreSQL. On first use after upgrading from the old in-memory session
implementation, sign in once with `1234` or `5678`.

This mechanism intentionally has **one shared demo applicant identity and one
shared demo reviewer identity**, not individual user accounts. Each role requires a
different passcode. The backend enforces role checks and application ownership on
all draft, suggestion, message, upload, PDF and submission routes. Reviewer draft
access is denied; reviewers see submitted snapshots only. Unknown/not-owned
resources return 404. Shared source PDFs require sign-in too. Session cookies are
HttpOnly/SameSite=Strict, stored as token digests in PostgreSQL, and revoked at
logout/role switch. Cross-origin writes are rejected and login failures are bounded.

Legacy applications created before ownership existed remain **unassigned and
unchanged**. A local operator can explicitly assign a legacy application they are
authorized to show in the shared demo:

```sh
npm run demo:assign -- <legacy-application-id>
```

This changes only an unassigned application's owner to the shared demo applicant;
it does not change its answers, source evidence, suggestions, uploads or conversation.
It refuses already assigned applications. No legacy application was automatically
assigned during implementation.

## Applicant flow

1. Sign in as Applicant. Enter a project title and start an application, or upload a
   PDF directly (which creates a draft). Resume through **Saved applications**.
2. Add/save A–D answers, accept/reject suggestions and upload project PDFs as before.
   Source verification remains separate from accepting a suggestion. Manual Section
   C values and national intent compatibility may remain unverified.
   To remove an application that has never been submitted, open it from **Saved
   applications**, choose **Delete draft**, and confirm **Permanently delete draft**.
   This deletes its local answers, uploads, conversation and suggestions. It does
   not delete shared reference sources or remote agent-session records. Submitted
   applications and their review history cannot be deleted through this action.
3. **Submit for review** freezes a numbered revision. Save or discard form edits
   first. Missing/optional/unverified information does not disappear or turn verified
   during submission. Submission is an internal portal action, not a claim that the
   SCC-submission checkbox should be selected.
4. **Submitted snapshot / reviewer feedback** opens that revision's read-only PDF,
   uploaded documents, source material, findings and review history. Earlier revisions
   remain available through the submission-history selector.
5. The working draft stays editable. Edits, later uploads, suggestion reviews and
   conversations do not modify the submitted revision. A second active submission
   is blocked while the latest revision is `submitted`. After `changes_requested` or
   `review_complete`, submit a new revision; the old snapshot and notes remain.

## Reviewer flow

1. Sign in as Safety Codes Officer / reviewer. The queue lists only applications
   with submissions, using their latest revision. It displays project title,
   applicant, jurisdiction, submission timestamp, workflow status and findings counts.
   **Refresh** picks up new submissions from a simultaneous applicant session.
2. Open an application. Review A–D values and evidence alongside the frozen variance
   PDF or a submitted uploaded PDF. No draft editing or suggestion acceptance is
   available in this view.
3. Original citations open a **frozen source PDF at the cited physical page**. The
   reference library also has page selectors. The existing Alberta 2023 second
   printing and NBC 2020 intent supplement are copied into the revision; full national
   NBC 2020 is **not** a prerequisite. Library candidates are labelled as library
   candidates, not accepted application mappings, and preserve exact references,
   scopes, attribution groups, pages and unverified compatibility statuses.
4. Findings have two separate states:
   - Submitted fact status: `missing`, `needs_clarification`, `unverified`, `provided`,
     or `not_applicable` (displayed as optional/not applicable).
   - Reviewer assessment: `unreviewed`, `reviewed`, or `needs_clarification`.
   Marking an unverified finding reviewed records that the reviewer inspected the
   blocker; its submitted status stays unverified. It does not write to
   `code_provisions`, `provision_attributions`, `code_attributions` or their review log.
5. Add a note, **Mark reviewed**, **Needs clarification**, or **Save note**. Clarification
   requires a note. Notes are append-only records with actor, action and database
   timestamp; finding assessment timestamps are stored separately. The applicant
   can read the feedback inside the portal; nothing is sent externally.
6. Add a reviewer summary and select **Request changes** or **Mark review complete**.
   Review complete requires every finding's assessment to be `reviewed`, including
   optional/provided findings. This means the administrative checklist was inspected;
   missing facts and source uncertainty can still be recorded. No approval/refusal
   status or endpoint exists. Closed or superseded revisions cannot receive new
   review actions; applicant resubmission creates a new revision and new assessments.

## Snapshot and persistence contract

Migration 008 adds owner and workflow state, `application_submissions`,
`submission_documents`, `submission_references`, `submission_findings`, and
`submission_review_events`.

Each submission freezes:

- Application title/jurisdiction and exact saved form JSON, including accepted
  Section C/D evidence and existing verification metadata.
- A generated two-page PDF stored as bytes, rather than regenerating the review PDF
  from the mutable draft or a later template version.
- Uploaded PDF bytes, filenames, page counts and timestamps in separate snapshot rows.
- All suggestion values, metadata and accepted/pending/rejected statuses; saved
  conversation context is retained as context, not source verification.
- A fresh exact-provision attribution check when saved evidence identifies a source.
  Unresolved or mismatched evidence is frozen with explicit blockers.
- The existing reference-library candidate metadata and original source PDF bytes,
  metadata and SHA-256 hashes. Source/library presence does not assert applicability.

A transaction locks the application during capture. A database advisory lock prevents
submitting while an agent turn is active. Uploads, form saves and suggestion reviews
serialize through the application row lock. Uploads after capture remain in the
working draft until a later submission. Reviewer actions update only finding
assessments/workflow state and append events; snapshot content/PDF bytes are not
updated by any HTTP endpoint. The database operator can still mutate records directly;
this is not a tamper-evident regulatory records system.

Section D matches an upload only by exact filename in this prototype. It explicitly
labels that match as evidence of presence, **not** document relevance, authorship,
completion or technical adequacy. A recommendation is not an upload. A recommended
professional role is not an actual named/engaged/licensed professional. A name provided
by the applicant is labelled accordingly, without identity or licence verification.

## Completeness policy and source limits

The findings are a deterministic demonstration checklist, not a claim that every
field is mandatory under legislation. It flags owner/mailing address/request date,
jurisdiction, a site address unless jurisdiction-wide, code/edition, missing cells
in occupied C rows, unverified mapping evidence, documentation questions and pending
suggestions. Permit number, representative, unused table rows and non-applicable ATS
are not invented mandatory requirements. ATS supplied without sufficient context
is sent for clarification. Supporting-document scope and professional involvement
remain reviewer questions. Signature fields are not required for this intake review.
A reviewer must assess conditional requirements for the real project type.

Alberta/national edition and scope uncertainty is preserved. There is no national-
to-Alberta compatibility inference, automatic source verification, fictional code
mapping, technical approval or engineering analysis in this workflow. STANDATA and
municipal guidance, when supplied, are scoped supporting references, not project
approvals. Source review/import remains the separate workflow in
`docs/verified-attributions.md`.

## Validation

```sh
npm run build
npm test
npm run lint
npm run test:review
```

`npm test` runs offline regression/access tests and skips the live PostgreSQL case
unless explicitly enabled. `npm run test:review` exercises the full HTTP/database
flow against the configured local database and existing reference collection. It
creates clearly labelled **fictional demo applications** and leaves them available
for demonstration; it does not delete or alter pre-existing applications. The run
uses generated temporary role passcodes and calls local deterministic tools to
create pending recommendations; it makes **no OpenAI calls and sends no messages**.

Covered cases include missing address, optional permit/representative, unverified
manual Section C values, pending versus accepted suggestions, recommended versus
uploaded documents, professional roles versus supplied names, role/ownership/PDF
boundaries, source/PDF byte hashes, frozen snapshots after draft edits and later
uploads, clarification notes/timestamps, invalid approval status rejection, early
completion rejection, changes requested, revision history, closed-revision actions,
resubmission and internal review completion. Verified source-row counts are checked
before/after review actions.

Firefox was also used to check both role sign-ins, applicant resume/submitted
feedback, reviewer queue, rendered submitted PDF, and saving a clarification note
through the reviewer UI. Temporary verification servers/tabs were closed afterwards.

## Before public deployment

The backend remains bound to loopback and refuses to start with `NODE_ENV=production`.
The demo mechanism is deliberately **not production authentication**. Replace shared
role passcodes and unlimited-duration demo sessions with managed individual identity, reviewer
assignment, organization/tenant isolation and durable session revocation. Add HTTPS
and Secure cookies with production origin/CSRF policy, stronger rate limiting,
operational authorization/audit controls and credential rotation. The local assignment
CLI is an operator convenience, not a public self-service claim mechanism.

Also required: authoritative conditional completeness policy, licensed-professional
review processes, attachment-to-recommendation IDs and document validation, records
retention/backups, access logging, storage quotas/deduplication, pagination, accessibility
and multi-browser/mobile validation, concurrency/load/security testing, and a genuine
regulatory submission/decision workflow if one is later authorized. Copying source
PDFs per revision trades storage for fidelity and is suitable only for this prototype.

## Persistence and restart verification

The fixed passwords live in `server.ts`, independent of database contents. Migration
009 adds durable hashed session tokens and role credential fingerprints in
`demo_sessions`; no raw login token is stored in the database. Cookie role switching
and explicit logout revoke only the relevant token. A temporary database outage
does not erase the browser cookie or session record.

The database binds `/var/lib/postgresql/data` to `./database/postgres` on the host.
Compose and the running container use `restart: unless-stopped`. Normal database,
backend and Docker restarts retain applications, uploads, immutable submission PDF
bytes, source copies, accepted/pending suggestions and review history. This is
persistence of the existing records, not an automatic seed/reset process: deleted
drafts are not recreated. Removing the underlying database data directory is a
reset, not a normal restart.

Applicant and reviewer lists are reloaded from PostgreSQL. Browser storage remembers
only the selected application ID; after refresh, the applicant reopens its saved
working draft and the reviewer reopens the latest submission for its selected
application. Form content and credentials are not cached in localStorage. Saved
edits survive; unsaved editor input still requires Save.

For a quiet local database with no concurrent editing, reproduce the persistence
check (the private manifest briefly contains test-session cookies; keep it outside
the repository):

```sh
node --import tsx scripts/check-demo-persistence.ts capture /tmp/variance-persistence.json
docker restart postgres
# Wait for PostgreSQL to be ready. To check the watched backend too:
touch server.ts
node --import tsx scripts/check-demo-persistence.ts verify /tmp/variance-persistence.json
```

The check logs in both demo roles, compares applicant/reviewer lists and counts plus
SHA-256 digests of stored application content and PDF bytes before/after restart,
then revokes its temporary sessions and removes their raw tokens from the manifest.
It does not delete, replace or reseed applications. The actual local Postgres and
backend were restarted during implementation: all 17 stored applications, 5
submission revisions, 113 findings and 53 review events were unchanged. Both existing
test-role sessions continued to work; 3 applicant applications and 2 reviewer queue
entries remained accessible. A separate regression test advances the clock by nine
hours and creates a fresh backend instance to verify session persistence, cookie
renewal, logout and password-change invalidation.
