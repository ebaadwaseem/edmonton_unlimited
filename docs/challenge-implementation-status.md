# Challenge implementation status

Source of truth: `database/pdf/challange_information/Building-Codes-Challenge-with-Appendix-.pdf`,
especially Detailed Technical Scope on physical page 3 and Appendix 1. Export uses
the separately supplied `database/pdf/templates/Variance_Template.pdf`, Part 1 only.

## Implemented

- Two-page, fillable Part 1 preview/export; original template remains unchanged.
- All 50 text, date, and checkbox controls on the first two pages: A applicant data
  and request date; B SCC-submission checkbox, permit/address, and eight ATS values;
  C code/standard and five attribution rows; D five document/responsible-party rows;
  printed signer names and the two signature dates.
- PDF editing and the full-size **Edit Part 1 · A–D** editor share draft changes,
  explicit Save/Discard, and the same field definitions. Digital signature widgets
  remain in the exported PDF for signing in an appropriate PDF application; typing
  a name does not sign the application.
- Exact-document/edition/provision/scope lookup of reviewed objective/function/intent data,
  rank, relevance paragraph, benchmark, and physical source-page citations.
  Accepting a Section C proposal fills the entire row in a transaction, using a
  fresh lookup and a check against the values shown at proposal time; generic suggestions cannot bypass the reviewed mapping path.
- Section D recommendation tool saves technical issues, code references, professional
  role, engineering-screening flag, rationale, and source. Recommendations are
  distinguished from completed reports; responsible names are never inferred from
  suggested roles. Editing an actual responsible name retains the screening context.
- Manual attribution changes clear the affected review evidence. The client cannot
  manufacture server-trusted verification metadata through the form PATCH endpoint.
- Export fit validation rejects overflow rather than clipping or dropping rows;
  saves and accepted suggestions fail before committing an invalid PDF draft.
- Older agent configurations restart with the saved conversation supplied as context;
  local message history and application data remain intact.

## Data dependency and honest limits

The Section C mechanism is implemented, but automated reviewed attribution filling
requires a curated, externally reviewed dataset. PostgreSQL and the original PDFs
have now been inspected: five exact provision examples contain 15 real extracted
candidates, all needing review; national intent compatibility remains unverified.
See `docs/section-c-source-investigation.md` for physical-page evidence and blockers.
No mappings were invented or marked reviewed from search snippets. The challenge's
appendix references are guidance, not a substitute for checking edition-specific
article/attribution sources. See `docs/verified-attributions.md` for the import format.

The provided template has five C rows and five D rows. Additional items require an
explicit future continuation strategy, not silent truncation. It has one applicable
code/standard field; this prototype keeps verified proposals within one code/edition
per draft. Explanations and evidence are stored with the application and visible in
the editor, while the two-page PDF keeps the supplied template's layout.

The actual supplied template's B checkbox says the proposal **has been submitted to
SCC for jurisdictional review**. The challenge appendix describes a jurisdiction-wide,
non-site-specific proposal. These are not treated as interchangeable. The existing
`project.jurisdictionWide` answer remains separate from `project.sccSubmitted`.
The disclosure text also differs between the appendix and supplied template; the
supplied PDF's text is preserved rather than silently rewritten.

Engineering flags are a screening aid, not a final determination of professional
practice. The prompt references the Alberta regulator's definition:
https://www.apega.ca/dictionary/common-terminology (Engineering).
The tool must identify the specific work that raises concern and stop before
producing professional analysis, calculations, certification, or approval.

## Reviewer prototype update — 2026-10-28

- Applicant Submit for review and resubmission actions create numbered snapshots of
  saved A–D values/evidence, suggestions, conversation, PDF bytes, uploaded PDFs and
  original references. Later working-draft edits do not change a submitted revision.
- Authenticated reviewer queue and read-only A–D/PDF/source view with missing,
  clarification, unverified, provided and optional findings; separate reviewer assessments.
- Persistent finding notes, actor/timestamps, changes requested and review complete
  states, with revision history. No variance approval/refusal or technical compliance
  determination; reviewing a finding does not verify code attributions.
- Fixed local demo role passcodes, persistent PostgreSQL/HttpOnly sessions without
  an eight-hour timeout, and server-side role/owner checks.
  Legacy unassigned drafts are preserved, not automatically exposed. This is not
  individual production authentication; production startup is deliberately disabled.
- Existing Alberta code/NBC 2020 supplement suffice for source inspection. Full
  national NBC 2020 is not a workflow prerequisite; compatibility remains unverified
  unless separately established through the source-review process.
- Offline tests plus a live fictional HTTP/PostgreSQL flow cover submission, notes,
  changes requested, resubmission, completion, access boundaries and snapshot fidelity.
  Both roles and a persisted reviewer note were also checked in Firefox.

See `docs/reviewer-demo.md` for access, state semantics, checklist limits and public
deployment requirements.

## Remaining challenge work

- Curate and review a representative edition-specific attribution dataset; run
  end-to-end evaluations of article ranking, benchmark selection, and citations.
- Improve building/product intake and conditional completeness rules across
  different project types. Empty optional fields currently do not block saving.
- Validate professional-involvement screening against reviewed real examples.
- Validate the prototype completeness policy and reviewer usability against real
  authorized workflows and project-specific conditional requirements.
- Broader multi-browser/mobile, concurrency/load and security validation; the
  reviewer workflow has been exercised in Firefox and against the local database.
- Individual production identity/reviewer assignment, organizational access controls,
  retention/backups and secure deployment; local demo role/owner controls are implemented.

Persistence was verified by restarting the actual local PostgreSQL container and
watched backend: both saved role sessions and application/reviewer list contents
survived, with unchanged application/PDF/review record digests. The browser now
restores the saved application selection after refresh. Passwords remain fixed at
applicant `1234` and reviewer `5678`; migration 009 stores durable session tokens.
