# Section C source investigation — 2026-10-28

The existing source collection supports extraction of real candidate attributions,
but **zero real provision mappings or cross-edition intent links were verified**.
The five article identifiers are discovery starting points, not five complete
article-wide objective/function/intent mappings.

## Source inventory and identity

Both source PDFs are present on disk, stored as original bytes in PostgreSQL, and
fully indexed in `document_pages`. All page numbers below are physical PDF pages,
not the printed page labels. The import pins exact document bytes with SHA-256.

| Document | Database ID | Actual edition / printing | Physical pages / indexed pages | Identity evidence |
| --- | --- | --- | --- | --- |
| National Building Code – 2023 Alberta Edition, 2nd printing | 5 | Eleventh edition 2023; second printing; includes April 2026 revisions and errata | 1,578 / 1,578 | Cover/title pp. 1, 3; publication/printing p. 4 |
| Supplement to the NBC 2020: Intent Statements | 11 | NBC 2020; first release 2025 | 3,210 / 3,210 | Publication p. 1; introduction p. 2 |

Repository files:

- `database/pdf/national_building_codes/National Building Code – 2023 Alberta Edition, 2nd printing.pdf`
- `database/pdf/national_building_codes/Supplement to the NBC 2020- Intent Statements.pdf`

Before this work, all document `edition` and `jurisdiction` fields were null;
`code_articles` and `code_attributions` were empty. The candidate manifest adds
explicit metadata for IDs 5 and 11 only, after checking their exact byte hashes.
The old article-only tables remain intact as history. They are not a fallback for
new exact-provision lookups.

## What the documents actually show

The Alberta preface, physical p. 11 (printed ix), identifies Division A Section 3.2
as the functional statement definitions and says that attributions to requirements
or portions of requirements appear in a table following each Part of Division B.
Division B 1.1.2.1 on physical p. 89 and 3.10.1.1 on p. 321 locate the Part 3
attributions in **Table 3.10.1.1**. Table note (1), p. 354, directs readers to Parts 2
and 3 of Division A. Relevant definitions include OA1/OA2 on p. 71, F30 on p. 80,
and F73/F74 on p. 81. A table identifier such as `[F73-OA1]` is a paired functional
statement/objective attribution; it is not the full text of either definition.

Article-only aggregation is unsafe. Rows distinguish sentence numbers, clause
letters, subclauses (e.g. 3.8.3.12.(1)(d)(i), p. 353), groups of clauses, and textual
qualifications. Keep each bracketed pair/group and qualification together.

| Starting article | Article text, Alberta physical pages | Alberta attribution table pages | Smallest level actually needed in this article | National intent supplement physical pages |
| --- | --- | --- | --- | --- |
| 3.8.3.5 Ramps | 307–308 | 353 | Clause: sentence (1) distinguishes (b)/(e), (c), (d), (g), (h); sentence (4) distinguishes (a) from (b)/(c). Sentence (5) has its own pair. | 740–742 |
| 3.8.3.20 Counters | 316 | 354 | Sentence (1): `[F74-OA2]`. This does not justify using a single article-wide level for other articles. | 761 |
| 3.8.3.2 Barrier-Free Path of Travel | 306–307 | 352 | Clause: sentence (3) distinguishes (a)/(b), (c)/(d), (e)/(f), with separate objective/function pairs; other sentences have their own entries. | 736–738 |
| 3.8.3.6 Doorways and Doors | 308–309 | 353 | Sentence for the printed attribution rows; preserve each pair within a sentence. The supplement further separates risk/performance intents and exemptions. | 742–748 |
| 3.8.3.13 Universal Washrooms | 312–313 | 353 | Sentence, clause **and text scope**. (1)(g) is qualified as the coat-hook requirement; (1)(i) as the shelf requirement; the OA2 pair for (1)(b) applies to the portion about a door lockable from inside. | 753–755 |

The supplement uses **`Provision: 3.8.3.x.(sentence)`** headings, then `Objective`,
`Attributions`, bracketed function/objective groups, and numbered `Intent(s)`.
An attribution may identify more precise clause references under the sentence
heading. The heading, attribution group, clause list, textual qualification and
`Intent 1`/`Intent 2` label together identify the intent; `Intent 1` alone is not a
unique identifier. Some explanatory intents have no objective/function group, so
none should be invented for those entries. Entries can span physical pages:
3.8.3.2.(3)(a)/(b)'s OS3 attribution is on p. 736 and its intent continues on p. 737;
3.8.3.13.(1)(g)'s group is on p. 753 and intents on p. 754.

Visual inspection of Alberta p. 353 confirmed the two-column table and its text
qualifications; visual inspection of supplement p. 754 confirmed continued intents,
the shelf scope, lockable-door scope and sentence (2) boundary. Text extraction
was also checked on the complete relevant pages. Extraction is not authorized
mapping review.

## Compatibility and blockers

Alberta's own preface, physical p. 11, directs readers to the NBC 2020 supplement
and explicitly says intent statements are unavailable for requirements unique to
NBC(AE). The complementary-publications list on p. 14 includes the supplement.
The supplement's introduction, p. 2, limits its subject to the **national NBC**
Parts 2–9 of Division B. The Alberta preface supplies useful provenance for using
the supplement as a candidate source; it does **not** establish that every matching
number, clause wording, scope or attribution is unchanged in Alberta's April 2026
second printing.

The project has no imported full national **NBC 2020 building code** PDF for a
side-by-side normative provision comparison, no reviewed Alberta/national
provision crosswalk, and no supplied authorized compatibility decisions. The
national plumbing/fire/energy codes and challenge appendix are not replacements.
An authorized reviewer needs to establish compatibility of each selected source
provision, scope and intent against the exact Alberta printing, with evidence, or
identify an authoritative Alberta-specific source. Until then compatibility stays
`unverified`. No source was downloaded or silently substituted.

NRC's publication listing also describes NBC(AE) as based on NBC 2020 and notes
updated accessibility requirements. That broad relationship does not establish
per-provision equivalence:
https://www.nrc.canada.ca/en/certifications-evaluations-standards/codes-canada/codes-canada-publications/national-building-code-2023-alberta-edition

## Real candidate import performed

`database/reference_candidates/accessibility-2023-ab.json` contains a **partial
extraction sample**, not complete article coverage:

| Exact target | Scope | Alberta target page(s) | Candidate groups | Intent source page(s) |
| --- | --- | --- | --- | --- |
| 3.8.3.5.(1)(b) | clause | 307 | `[F73-OA1]`, `[F30-OS3.1]` | 740–741 |
| 3.8.3.20.(1) | sentence | 316 | `[F74-OA2]` | 761 |
| 3.8.3.2.(3)(a) | clause | 306 | `[F30-OS3.1]`, `[F73-OA1]` | 736–737 |
| 3.8.3.6.(2) | sentence | 308 | `[F73-OA1]` | 743 |
| 3.8.3.13.(1)(g) | “Applies to the requirement for a coat hook.” | 312–313 | `[F30-OS3.1]` | 753–754 |

These are 5 candidate provisions and 15 candidate records: 7 paired
objective/function records and 8 intent records. Grouped clause identifiers in the
source are retained even when a target represents one member of that group.
`source_excerpt` is a normalized transcription with expanded identifiers for the
compact table rows; it is not an assertion that the table prints the expanded
identifier on every line. Statement text for objective/function records is the
printed bracketed pair, not a generated definition. Exact source PDFs remain
accessible for checking original layout.

All 15 records are `needs_review`; all compatibility statuses are `unverified`.
No import/review command was run with an actual verification decision. Live
lookups for all five exact references returned `verified: false` and the strict
verified lookup returned `null`. Reimport inserted zero duplicates.

## Implementation and checks

Migration 007 adds provision references/levels/scopes, separate paired attribution
and intent records, source page ranges and fingerprints, source review status,
independent compatibility status/evidence, and an append-only review log. The
candidate importer defaults to unverified and rejects self-verifying input. Review
is a separate explicit workflow described in `docs/verified-attributions.md`.

The lookup uses the selected document ID/edition and exact provision **and scope**;
it never rolls up child mappings into an article-wide verified result. A reviewer
must attest completeness. Missing types, any active unreviewed candidate, missing
source metadata, changed source bytes, or absent cross-document compatibility
review block verified use. Suggestion acceptance performs a fresh lookup and
checks the mapping fingerprint. Manual entry remains possible and unverified.

Section C's source inspector shows edition selection, available precise references,
partial coverage, missing/review/compatibility blockers, paired IDs, and links to
source physical PDF pages. It has no action that marks an extraction verified.
The agent tools return the same blockers and cannot propose an unverified set.

Validation performed: source PDF text extraction and selected-page visual review;
transactional migration/import; idempotent reimport; live read-only lookups across
all five examples; automated checks for exact scope, edition, completeness,
source changes, cross-edition compatibility, stale reviews and acceptance; full
build/test/lint. Test-only reviewed fixtures do not write to the real database.
