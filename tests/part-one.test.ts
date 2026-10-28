import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFCheckBox, PDFDocument, PDFName, PDFTextField } from "pdf-lib";
import { createPreview, loadPartOneTemplate, PdfValidationError } from "../backend/template.ts";
import { applyFormFieldValues, FORM_FIELDS, FORM_FIELD_KEYS, validateFieldValue } from "../shared/form-fields.ts";
import { invalidateChangedEvidence } from "../shared/part-one.ts";

export function populatedPartOne() {
  const values = Object.fromEntries(FORM_FIELD_KEYS.map((key) => {
    const field = FORM_FIELDS[key];
    return [key, field.type === "checkbox" ? true : field.type === "date" ? "2026-10-28" : key.startsWith("sectionC.intent") ? "TEST ONLY: Review supplied evidence against the selected requirement." : key.startsWith("sectionC.") ? "TEST-1" : key.startsWith("sectionD.document") ? "Example supporting plan.pdf" : "Example entry"];
  }));
  return { values, form: applyFormFieldValues({}, values) };
}

test("all fifty Part 1 text/date/checkbox controls round-trip with appearances in exactly two pages", async () => {
  const { values, form } = populatedPartOne();
  assert.equal(FORM_FIELD_KEYS.length, 50);
  const pdf = await PDFDocument.load(await createPreview(form));
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.getForm().getFieldMaybe("SCO"), undefined);
  assert.ok(pdf.getForm().getFieldMaybe("Signature1"), "Owner signature field retained for external signing");
  for (const key of FORM_FIELD_KEYS) {
    const field = pdf.getForm().getField(FORM_FIELDS[key].pdfField);
    if (field instanceof PDFTextField) assert.equal(field.getText(), values[key]);
    else if (field instanceof PDFCheckBox) {
      assert.equal(field.isChecked(), true);
      const canonical = field.acroField.getValue();
      assert.ok(field.acroField.getWidgets().every((widget) => widget.getAppearanceState()?.toString() === canonical?.toString()));
    } else assert.fail(`Unsupported field ${key}`);
    for (const widget of field.acroField.getWidgets()) {
      assert.ok(widget.getNormalAppearance());
      const parent = widget.dict.get(PDFName.of("Parent"));
      if (parent) assert.equal(pdf.context.lookup(parent), field.acroField.dict);
    }
  }
  const unchecked = await PDFDocument.load(await createPreview({ project: { sccSubmitted: false } }));
  assert.equal(unchecked.getForm().getCheckBox("Check Box").isChecked(), false);
});

test("Section C attribution widgets use the full table cell without crossing rows", async () => {
  const pdf = await loadPartOneTemplate();
  for (let row = 1; row <= 5; row++) {
    const cell = pdf.getForm().getTextField(FORM_FIELDS[`sectionC.intent${row}` as keyof typeof FORM_FIELDS].pdfField).acroField.getWidgets()[0].getRectangle();
    for (const column of ["article", "objective", "function"]) {
      const field = pdf.getForm().getTextField(FORM_FIELDS[`sectionC.${column}${row}` as keyof typeof FORM_FIELDS].pdfField);
      const rect = field.acroField.getWidgets()[0].getRectangle();
      assert.equal(rect.y, cell.y); assert.equal(rect.height, cell.height); assert.equal(field.isMultiline(), true);
    }
  }
});

test("invalid dates and overflow fail explicitly rather than truncating two-page exports", async () => {
  assert.throws(() => validateFieldValue("applicant.requestDate", "2026-02-30"), /valid YYYY-MM-DD/);
  assert.throws(() => validateFieldValue("project.sccSubmitted", "true"), /true or false/);
  await assert.rejects(createPreview({ sectionC: { intent1: "A long sentence that cannot fit this cell. ".repeat(120) } }), PdfValidationError);
});

test("manual attribution edits remove only the affected verification evidence and cannot forge new verification", () => {
  const current = { sectionC: { code: "Code edition", article1: "1", article2: "2" }, sectionCEvidence: { 1: { verified: true }, 2: { verified: true } }, sectionD: { document1: "Report" }, sectionDEvidence: { 1: { status: "recommended" } } };
  const proposed = { ...current, sectionC: { ...current.sectionC, article1: "changed" }, sectionCEvidence: { 1: { verified: true }, 3: { verified: true } } };
  const result = invalidateChangedEvidence(current, proposed);
  assert.equal(result.sectionCEvidence[1], undefined); assert.equal(result.sectionCEvidence[3], undefined);
  assert.deepEqual(result.sectionCEvidence[2], { verified: true });
  assert.deepEqual(result.sectionDEvidence[1], { status: "recommended" });
});
