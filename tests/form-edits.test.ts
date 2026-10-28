import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFormFieldValues } from "../shared/form-fields.ts";
import type { FormFieldValues } from "../shared/form-fields.ts";

test("manual form edits preserve other answers, jurisdiction flags, and Section C/D data", () => {
  const original = {
    applicant: { ownerName: "Original owner", representative: "Existing representative", requestDate: "2026-10-28" },
    project: { municipalAddress: "Old address", jurisdictionWide: true, legalDescription: "Existing legal description" },
    codeArticles: [{ article: "verified example" }], supportingDocuments: [{ name: "Plan.pdf" }],
  };
  const updated = applyFormFieldValues(original, { "applicant.ownerName": "Corrected owner", "project.municipalAddress": "New address" });
  assert.equal(updated.applicant.ownerName, "Corrected owner");
  assert.equal(updated.applicant.representative, "Existing representative");
  assert.equal(updated.applicant.requestDate, "2026-10-28");
  assert.equal(updated.project.municipalAddress, "New address");
  assert.equal(updated.project.jurisdictionWide, true);
  assert.equal(updated.project.legalDescription, "Existing legal description");
  assert.deepEqual(updated.codeArticles, original.codeArticles);
  assert.deepEqual(updated.supportingDocuments, original.supportingDocuments);
  assert.equal(original.applicant.ownerName, "Original owner");
});

test("manual edits can clear optional values or initialize missing sections", () => {
  const updated = applyFormFieldValues({ applicant: { representative: "Previous" } }, { "applicant.representative": "", "project.permitNumber": "BP-42" });
  assert.equal(updated.applicant.representative, "");
  assert.equal((updated as unknown as { project: { permitNumber: string } }).project.permitNumber, "BP-42");
});

test("manual editing rejects unsupported paths rather than modifying arbitrary form data", () => {
  for (const key of ["__proto__.polluted", "constructor.prototype", "codeArticles.0"]) {
    assert.throws(() => applyFormFieldValues({}, { [key]: "unexpected" } as FormFieldValues), /Unsupported form edit/);
  }
});
