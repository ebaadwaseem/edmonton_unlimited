# Public release checklist

## Before making the repository public

- [ ] Review all tracked PDFs, the template, challenge materials, and extracted
  source excerpts for permission to redistribute. Record their sources and terms.
  Keep any unapproved material local and document how users obtain their own copy.
  Removing a tracked file or adding it to `.gitignore` does not remove old commits.
- [ ] Scan the complete Git history for secrets and private applicant information,
  including documents, database exports, logs, and screenshots. Rotate any exposed
  credentials and resolve affected history before publishing.
- [ ] Choose a license for code you have permission to license. Identify third-party
  documents separately; do not assume the code license covers those materials.
- [ ] Test the README from a clean clone with a new database. Confirm the required
  model and agent-session API are accessible to the intended users.
- [ ] Run `npm test`, `npm run lint`, and `npm run build`. Add CI to run those checks
  with Poppler installed and dummy database environment variables. Offline tests
  mock PostgreSQL and do not require a model key.
- [ ] Audit dependencies and review any findings before release.

## Make it useful as a portfolio project

- [ ] Add a screenshot or short recording using fictional applicant data, showing
  a cited answer, an accepted suggestion, the PDF, and reviewer feedback.
- [ ] Add a short GitHub description and topics matching the actual stack.
- [ ] Describe your own contribution and design decisions: page-level retrieval,
  source inspection, human-reviewed suggestions, and frozen submission revisions.
- [ ] Include measured results only when you have evidence, such as indexing time,
  document/page counts, or a recorded task evaluation. Avoid invented impact claims.

Possible résumé wording (adjust to reflect your contribution):

> Built a React/TypeScript and Express prototype for Alberta variance applications,
> integrating a tool-calling AI agent with PostgreSQL full-text PDF retrieval,
> human-reviewed form suggestions, fillable PDF export, and revision-based review.

## If hosting a public demo

The existing server binds to localhost, uses fixed shared role passcodes, and
rejects production startup. A public repository does not make that access model
ready for public hosting.

- [ ] Implement individual authentication, ownership, and reviewer authorization.
- [ ] Configure HTTPS, secure session handling, rate limits, model usage limits,
  and upload/storage limits for the deployment.
- [ ] Define retention and deletion for project documents, conversations, and model
  sessions; explain which content is sent to the model provider.
- [ ] Serve the built frontend with a production server and configure the API and
  allowed origins for that deployment. `npm run build` creates the frontend bundle;
  it does not deploy the API.
- [ ] Use fictional records in a demo and protect any persistent application data.

## Cleanup boundaries

The initial cleanup removes unused starter assets/CSS, moves the standalone PDF
vision experiment to `scripts/experiments/`, and moves the long README notes into
`docs/development-notes.md`. Application code, migrations, reference bytes, and
the PDF template keep their existing locations.

Keep SQL migration filenames and the PDF template path stable unless you update
their callers and verify an existing database upgrade. Source attribution records
also depend on document IDs and exact PDF byte hashes. The extensionless
`database/pdf/user_guides_and_illustrations/Illustrated User's Guide, NBC 2020 Part 9`
is currently skipped by the PDF importer; deliberately review it before changing
that behavior or adding it to a public corpus.
