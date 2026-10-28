import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPreview, loadFormMarkers } from "../backend/template.ts";
import { applyFormFieldValues, FORM_FIELDS, FORM_FIELD_KEYS } from "../shared/form-fields.ts";

test("Section C and D values reach the PDF.js canvas on both preview pages", async () => {
  const { getDocument, AnnotationMode, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const keys = FORM_FIELD_KEYS.filter((key) => ["C", "D"].includes(FORM_FIELDS[key].section));
  const values = Object.fromEntries(keys.map((key, index) => [key, `VALUE-${index}`]));
  const bytes = await createPreview(applyFormFieldValues({}, values));
  const markers = await loadFormMarkers();
  const loading = getDocument({
    data: bytes,
    standardFontDataUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)),
    verbosity: 0,
  });
  try {
    const pdf = await loading.promise;
    for (let pageNumber = 1; pageNumber <= 2; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      // Match react-pdf's canvas rendering with its HTML annotation layer off.
      const operators = await page.getOperatorList({ annotationMode: AnnotationMode.ENABLE });
      const text = operators.argsArray.flatMap((args, index) => operators.fnArray[index] === OPS.showText
        ? [args[0].map((glyph: { unicode: string } | number) => typeof glyph === "object" ? glyph.unicode : "").join("")]
        : []);
      for (const key of keys.filter((key) => markers.some((marker) => marker.key === key && marker.page === pageNumber))) {
        assert.ok(text.includes(values[key]), `${key} must render on page ${pageNumber}`);
      }
    }
    assert.equal(markers.find((marker) => marker.key === "sectionC.article1")?.page, 1);
    assert.equal(markers.find((marker) => marker.key === "sectionC.article2")?.page, 2);
    assert.equal(markers.find((marker) => marker.key === "sectionD.document1")?.page, 2);
  } finally {
    await loading.destroy();
  }
});
