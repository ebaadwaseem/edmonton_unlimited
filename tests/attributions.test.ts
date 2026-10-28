import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../backend/db.ts";
import { attributionFingerprint, inspectAttributions, lookupVerifiedAttributions } from "../backend/attributions.ts";
import { acceptSuggestedValue } from "../backend/suggestion-values.ts";
import { parseProvisionReference } from "../shared/provision-reference.ts";

// Reviewed statuses below are offline fixtures only. No production row is verified.
const reference = "3.8.3.6.(2)";
function fixtureRows() {
  const common = { verification_status: "verified", reviewed_by: "Test fixture reviewer", reviewed_at: "2026-10-28", review_basis: "TEST ONLY source review",
    source_unchanged: true, source_pdf_page_start: 4, source_pdf_page_end: 4, source_page_count: 1000, source_title: "Fixture source", source_edition: "Fixture edition", source_jurisdiction: "Fixture jurisdiction", source_reference: reference, source_scope: "", compatibility_status: "verified", compatibility_basis: "TEST ONLY compatibility review", compatibility_reviewed_by: "Test reviewer", compatibility_reviewed_at: "2026-10-28" };
  return [{ ...common, id: 1, kind: "objective_functional", objective_ids: ["OA1"], functional_ids: ["F73"], attribution_group: "[F73-OA1]", statement_label: "", statement_text: "[F73-OA1]", source_document_id: 5 },
    { ...common, id: 2, kind: "intent", objective_ids: [], functional_ids: [], attribution_group: "[F73-OA1]", statement_label: "Intent 1", statement_text: "TEST ONLY reviewed intent.", source_document_id: 11 }];
}
function mockLookup(t: any, options: { incomplete?: boolean; compatibility?: string; sourceChanged?: boolean; missingEdition?: boolean; scope?: string; extraUnreviewed?: boolean } = {}) {
  t.mock.method(db, "query", async (sql: string, params: unknown[]) => {
    if (sql.includes("FROM documents WHERE")) return { rows: [{ id: 5, title: "Fixture code", edition: options.missingEdition ? null : "Fixture edition", jurisdiction: "Fixture jurisdiction", reference_role: "code", page_count: 1000 }] };
    if (sql.includes("FROM code_provisions")) {
      assert.equal(params[0], 5);
      return { rows: [{ id: 1, document_id: 5, article_number: "3.8.3.6", reference, reference_level: options.scope ? "text_span" : "sentence", scope: options.scope ?? "", pdf_page_start: 7, pdf_page_end: 7,
        verification_status: "verified", reviewed_by: "Test reviewer", reviewed_at: "2026-10-28", review_basis: "TEST ONLY completeness review", source_unchanged: !options.sourceChanged }] };
    }
    assert.match(sql, /FROM provision_attributions/);
    const rows = fixtureRows();
    if (options.compatibility) rows[1].compatibility_status = options.compatibility;
    if (options.incomplete) rows.pop();
    if (options.extraUnreviewed) rows.push({ ...rows[0], id: 3, verification_status: "needs_review" });
    return { rows };
  });
}

test("reference parsing preserves exact sentence, clause, subclause and text scope", () => {
  assert.equal(parseProvisionReference("3.8.3.5").reference, "3.8.3.5.");
  assert.equal(parseProvisionReference("3.8.3.5.(1)(c)(ii)").level, "subclause");
  assert.equal(parseProvisionReference("3.8.3.13.(1)(g)", "coat hook").level, "text_span");
  assert.throws(() => parseProvisionReference("3.8.3.5.(1)(b),(e)"), /exact/);
});
test("exact reviewed provision fixture retains paired IDs, edition and source references", async (t) => {
  mockLookup(t);
  const mapping = await lookupVerifiedAttributions(5, reference);
  assert.equal(mapping?.objective, "OA1"); assert.equal(mapping?.function, "F73");
  assert.equal(mapping?.reference, reference); assert.equal(mapping?.citations.length, 3);
  assert.equal(mapping?.statements[0].attributionGroup, "[F73-OA1]");
});
test("article queries offer precise references without combining clause attributions", async (t) => {
  mockLookup(t);
  const report = await inspectAttributions(5, "3.8.3.6.");
  assert.equal(report.verified, false); assert.equal(report.provision, null);
  assert.equal(report.available[0].reference, reference);
  assert.equal(await lookupVerifiedAttributions(5, "3.8.3.6."), null);
});
test("text scopes must match exactly", async (t) => {
  mockLookup(t, { scope: "coat hook only" });
  assert.equal(await lookupVerifiedAttributions(5, reference), null);
  assert.ok(await lookupVerifiedAttributions(5, reference, "coat hook only"));
});
for (const [name, option] of Object.entries({ incomplete: { incomplete: true }, compatibility: { compatibility: "unverified" }, incompatible: { compatibility: "incompatible" }, changedSource: { sourceChanged: true }, unknownEdition: { missingEdition: true }, unreviewedAdditionalPair: { extraUnreviewed: true } })) {
  test(`${name} cannot become a verified provision mapping`, async (t) => {
    mockLookup(t, option);
    assert.equal(await lookupVerifiedAttributions(5, reference), null);
    assert.ok((await inspectAttributions(5, reference)).blockers.length);
  });
}
test("incomplete attribution sets cannot be accepted", async (t) => {
  mockLookup(t, { incomplete: true });
  await assert.rejects(acceptSuggestedValue({}, { field_key: "sectionC.article1", suggested_value: reference, metadata: { kind: "verified_article", row: 1, documentId: 5 } }), /complete verified/);
});
test("Section C acceptance uses a fresh exact provision lookup for all columns", async (t) => {
  mockLookup(t);
  const mapping = await lookupVerifiedAttributions(5, reference);
  const accepted = await acceptSuggestedValue({ applicant: { ownerName: "Example" } }, { field_key: "sectionC.article1", suggested_value: reference, metadata: { kind: "verified_article", row: 1, documentId: 5, mappingFingerprint: attributionFingerprint(mapping!), objective: "forged" } });
  assert.equal(accepted.sectionC.objective1, "OA1"); assert.equal(accepted.sectionC.function1, "F73");
  assert.equal(accepted.sectionC.article1, reference); assert.equal(accepted.sectionCEvidence[1].verified, true);
  assert.equal(accepted.applicant.ownerName, "Example");
});
test("generic suggestions cannot bypass verified Section C lookup", async () => {
  await assert.rejects(acceptSuggestedValue({}, { field_key: "sectionC.intent1", suggested_value: "Invented intent" }), /requires direct user entry/);
});
test("Section D recommendations do not invent responsible people or completed reports", async () => {
  const accepted = await acceptSuggestedValue({}, { field_key: "sectionD.document1", suggested_value: "Fixture evaluation report", metadata: { kind: "supporting_document", row: 1 } });
  assert.equal(accepted.sectionD.document1, "Fixture evaluation report"); assert.equal(accepted.sectionD.responsible1, undefined);
  assert.equal(accepted.sectionDEvidence[1].status, "recommended");
});
test("changed reviewed mapping requires a fresh proposal", async (t) => {
  mockLookup(t);
  await assert.rejects(acceptSuggestedValue({}, { field_key: "sectionC.article1", suggested_value: reference, metadata: { kind: "verified_article", row: 1, documentId: 5, mappingFingerprint: "outdated" } }), /changed since this suggestion/);
});
