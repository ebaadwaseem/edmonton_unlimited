import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { AnnotationFlags, PDFDocument, PDFName, degrees } from "pdf-lib";
import { createPreview, getFormMarkers, loadFormMarkers, loadTemplateBytes } from "../backend/template.ts";
import { FORM_FIELDS, FORM_FIELD_KEYS } from "../shared/form-fields.ts";

test("filled previews preserve the source and persist field values and widget appearances", async () => {
  const original = await loadTemplateBytes();
  const hash = createHash("sha256").update(original).digest("hex");
  const expected = ["Jane Example", "Alex Representative", "100 Example Street\nEdmonton AB", "200 Example Avenue", "BP-12345"];
  const output = await createPreview({
    applicant: { ownerName: expected[0], representative: expected[1], mailingAddress: expected[2] },
    project: { municipalAddress: expected[3], permitNumber: expected[4] },
  });
  const pdf = await PDFDocument.load(output);
  assert.equal(pdf.getPageCount(), 5);
  const fields = pdf.getForm();
  for (const [index, key] of FORM_FIELD_KEYS.entries()) {
    const field = fields.getTextField(FORM_FIELDS[key].pdfField);
    assert.equal(field.getText(), expected[index]);
    for (const widget of field.acroField.getWidgets()) {
      assert.ok(widget.getNormalAppearance(), `${key} has a normal appearance`);
      const parent = widget.dict.get(PDFName.of("Parent"));
      assert.equal(pdf.context.lookup(parent), field.acroField.dict);
      assert.equal(widget.dict.get(PDFName.of("V")), undefined, "widget inherits canonical field value");
      assert.equal(field.acroField.getValue()?.decodeText(), expected[index]);
    }
  }
  assert.ok(fields.getField("Logo Popup").acroField.getWidgets().every((widget) => widget.hasFlag(AnnotationFlags.Hidden)));
  assert.ok(fields.getFieldMaybe("Article(s)"), "Section C remains interactive");
  assert.equal(createHash("sha256").update(await loadTemplateBytes()).digest("hex"), hash);
  // Each call starts from pristine bytes, so one application's values never leak.
  const blank = await PDFDocument.load(await createPreview({}));
  assert.equal(blank.getForm().getTextField("Owner").getText() ?? "", "");
});

test("template markers match every supported widget on its actual page", async () => {
  const pdf = await PDFDocument.load(await loadTemplateBytes());
  const markers = await loadFormMarkers();
  assert.equal(markers.length, FORM_FIELD_KEYS.length);
  for (const marker of markers) {
    const page = pdf.getPage(marker.page - 1);
    const widget = pdf.getForm().getTextField(FORM_FIELDS[marker.key].pdfField).acroField.getWidgets()[0];
    const rect = widget.getRectangle();
    assert.equal(page.ref.toString(), widget.P()?.toString());
    assert.ok(Math.abs(marker.left * page.getWidth() - rect.x) < 0.001);
    assert.ok(Math.abs((1 - marker.top) * page.getHeight() - rect.y - rect.height) < 0.001);
    assert.ok(marker.width > 0 && marker.height > 0);
  }
});

test("marker normalization handles crop origins and all right-angle rotations on another page", async () => {
  for (const rotation of [0, 90, 180, 270]) {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 400]);
    const page = pdf.addPage([300, 400]);
    page.setCropBox(50, 100, 200, 200);
    page.setRotation(degrees(rotation));
    for (const key of FORM_FIELD_KEYS) {
      pdf.getForm().createTextField(FORM_FIELDS[key].pdfField)
        .addToPage(page, { x: 70, y: 140, width: 40, height: 20, borderWidth: 0 });
    }
    const marker = getFormMarkers(pdf)[0];
    const expected: Record<number, number[]> = {
      0: [0.1, 0.7, 0.2, 0.1], 90: [0.2, 0.1, 0.1, 0.2],
      180: [0.7, 0.2, 0.2, 0.1], 270: [0.7, 0.7, 0.1, 0.2],
    };
    assert.equal(marker.page, 2);
    [marker.left, marker.top, marker.width, marker.height].forEach((v, i) =>
      assert.ok(Math.abs(v - expected[rotation][i]) < 0.001, `${rotation}: coordinate ${i}`));
  }
});
