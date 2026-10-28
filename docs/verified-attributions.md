# Import and review of exact-provision attributions

See [the source investigation](section-c-source-investigation.md) for real PDF
findings and current blockers. **No real mapping has been verified.**

## Candidate import

```sh
npm run db:migrate
npm run db:attributions -- database/reference_candidates/accessibility-2023-ab.json
```

This transaction imports only `needs_review` candidates. It never verifies source
attributions or edition compatibility. Reimporting identical records is idempotent.
Document metadata updates require a matching SHA-256 manifest. A new candidate
invalidates the provision's completeness review; previous review records remain.
Unreviewed page ranges can be corrected before review, but reviewed ranges cannot
be overwritten through import. Source-byte changes require resolving source
version identity, not silently replacing a reviewed source.

Dataset structure (the checked-in JSON contains real source candidates):

- `documents`: `{id, sha256, edition, jurisdiction, role}`. Role is `code` or
  `intent_supplement`. Metadata describes the actual PDF/printing, not an assumed
  compatible edition.
- `provisions`: target `document_id`, exact `reference`, optional exact text `scope`,
  physical `pdf_page_start`/`pdf_page_end`, and `attributions`. Reference level is
  derived from article/sentence/clause/subclause identifiers; nonempty scope means
  `text_span`. Groups of clauses must not be treated as a single exact reference.
- Each attribution: `kind` (`objective_functional` or `intent`), exact
  `attribution_group`, `statement_label`, `statement_text`, `source_document_id`,
  exact `source_reference` (including grouped source identifiers), `source_scope`,
  physical `source_pdf_page_start`/`source_pdf_page_end`, and `source_excerpt`.
  Paired attributions also have `objective_ids` and `functional_ids` arrays.
  Preserve bracketed pair/group relationships. Do not generate missing definitions.
  Imports reject attempts to set a verified status.

Partial sets are allowed so missing material is visible. A partial extraction is
not a completeness attestation. Original source documents remain unchanged.

## Explicit authorized review

An authorized reviewer must check the actual provision, complete applicable
attribution set, source text, identifiers/groups, textual scope, pages, edition and
printing. Review compatibility separately for any different source document,
particularly national 2020 intent proposed for 2023 Alberta. Matching numbers or
an extraction's confidence do not prove compatibility. A short provenance statement
without per-provision evidence must not be used as a blanket crosswalk.

Fetch the reviewable candidate IDs and immutable fingerprints with:

```sh
curl 'http://127.0.0.1:3001/api/attributions?documentId=5&reference=3.8.3.6.%282%29'
```

The target SHA-256 is in `provision.document_sha256`. Each candidate has an `id`
and `candidate_fingerprint`. Prepare an external review record with:

- `provision_id`, `expected_target_sha256`, `reviewed_by`, and `review_basis`.
  The basis must explain source checking and completeness of the exact scope.
- `decisions`: exactly one for **every** candidate currently stored for that
  provision, each containing `id`, `fingerprint`, and `status`
  (`verified`, `rejected`, or `needs_review`).
- Optional `compatibility: {status, basis}` per decision. Status is `unverified`,
  `verified` or `incompatible`. Verified/incompatible decisions require explicit
  evidence in `basis`; the reviewer's identity and timestamp are stored separately.
  Omission leaves compatibility **unverified**, even when source text was reviewed.

Only after that real external review:

```sh
npm run db:attributions -- --review /path/to/actual-authorized-review.json
```

This command records a supplied review; it cannot authenticate that a named person
is authorized or that review truly occurred. This local prototype has no reviewer
authentication. Do not run it to promote AI-generated candidates. No example
review fixture is supplied for production import. The transaction checks target
and source byte hashes, candidate fingerprints and complete decision coverage,
then appends the exact review record to `attribution_reviews`.

A same-document attribution still needs source review, but no cross-document
compatibility assertion. A different source document requires separately reviewed
compatibility evidence. Verified lookup requires all applicable active records to
be reviewed, at least one objective/function pair and an intent, explicit source
metadata and valid page ranges. Rejected records are retained as history. Even an
externally recorded review does not make an incomplete set usable.

## Lookup, suggestions and manual entry

`GET /api/attributions/documents` lists identified code editions.
`GET /api/attributions?documentId=…&reference=…&scope=…` reports exact candidates,
available references, missing types and blockers. An article query discovers
precise references; it does not synthesize an article mapping from child rows.

The agent passes the exact reference through its `article_number` argument and
passes `scope` separately. The existing argument name is retained for compatibility;
its value can now be a sentence, clause or subclause. Proposals require a complete
verified exact-scope mapping. Acceptance looks it up again and compares its
fingerprint. The PDF prints the exact reference and any textual scope; evidence
keeps source editions, references, pages and paired groups. Source changes require
a fresh proposal. Manual entry remains available and is not verified by saving.
