import { readFile } from "node:fs/promises";
import { AnnotationFlags, PDFCheckBox, PDFDocument, PDFName, PDFTextField, StandardFonts } from "pdf-lib";
import { FORM_FIELDS, FORM_FIELD_KEYS, readFormField, validateFieldValue } from "../shared/form-fields.ts";
import type { FormMarker } from "../shared/form-fields.ts";

// The local template is the source of truth. Cache bytes, never a mutable PDFDocument.
let templateBytes: Promise<Uint8Array> | undefined;
export function loadTemplateBytes(): Promise<Uint8Array> {
  templateBytes ??= readFile(new URL("../database/pdf/templates/Variance_Template.pdf", import.meta.url))
    .catch((error) => { templateBytes = undefined; throw error; });
  return templateBytes;
}

export async function loadPartOneTemplate(): Promise<PDFDocument> {
  const pdf = await PDFDocument.load(await loadTemplateBytes());
  const form = pdf.getForm();
  const pages = pdf.getPages().slice(0, 2);
  const retained = form.getFields().filter((field) => field.acroField.getWidgets().some((widget) =>
    pages.some((page) => page.ref.toString() === widget.P()?.toString() || page.node.Annots()?.asArray().some((ref) => pdf.context.lookup(ref) === widget.dict))));
  // Keep the canonical form tree intact without deleting referenced tagged-PDF objects.
  form.acroForm.dict.set(PDFName.of("Fields"), pdf.context.obj(retained.map((field) => field.ref)));
  while (pdf.getPageCount() > 2) pdf.removePage(2);
  // The first three columns have short widgets inside full-height table cells.
  // Expand within the existing cells so article/objective/function text can wrap.
  for (let row = 1; row <= 5; row++) {
    const intent = form.getTextField(FORM_FIELDS[`sectionC.intent${row}` as keyof typeof FORM_FIELDS].pdfField).acroField.getWidgets()[0].getRectangle();
    for (const column of ["article", "objective", "function"]) {
      const key = `sectionC.${column}${row}` as keyof typeof FORM_FIELDS;
      const field = form.getTextField(FORM_FIELDS[key].pdfField);
      field.enableMultiline();
      for (const widget of field.acroField.getWidgets()) widget.setRectangle({ ...widget.getRectangle(), y: intent.y, height: intent.height });
    }
  }
  return pdf;
}

export function getFormMarkers(pdf: PDFDocument): FormMarker[] {
  const pages = pdf.getPages();
  return FORM_FIELD_KEYS.flatMap((key) => {
    const field = pdf.getForm().getField(FORM_FIELDS[key].pdfField);
    return field.acroField.getWidgets().map((widget) => {
      const pageIndex = pages.findIndex((page) =>
        page.ref.toString() === widget.P()?.toString() ||
        page.node.Annots()?.asArray().some((ref) => pdf.context.lookup(ref) === widget.dict));
      if (pageIndex < 0) throw new Error(`No page found for ${field.getName()}.`);
      const page = pages[pageIndex];
      const crop = page.getCropBox();
      const media = page.getMediaBox();
      // PDF.js uses the intersection of the crop box and media box.
      const x = Math.max(crop.x, media.x), y = Math.max(crop.y, media.y);
      const width = Math.min(crop.x + crop.width, media.x + media.width) - x;
      const height = Math.min(crop.y + crop.height, media.y + media.height) - y;
      if (width <= 0 || height <= 0) throw new Error("Invalid PDF page bounds.");
      const r = widget.getRectangle();
      const rotation = ((page.getRotation().angle % 360) + 360) % 360;
      const transform = (px: number, py: number): [number, number] => {
        const u = (px - x) / width, v = (py - y) / height;
        switch (rotation) {
          case 0: return [u, 1 - v];
          case 90: return [v, u];
          case 180: return [1 - u, v];
          case 270: return [1 - v, 1 - u];
          default: throw new Error("Unsupported PDF page rotation.");
        }
      };
      const points = [transform(r.x, r.y), transform(r.x + r.width, r.y),
        transform(r.x, r.y + r.height), transform(r.x + r.width, r.y + r.height)];
      const left = Math.min(...points.map(([u]) => u));
      const top = Math.min(...points.map(([, v]) => v));
      return { key, label: FORM_FIELDS[key].label, page: pageIndex + 1, left, top,
        width: Math.max(...points.map(([u]) => u)) - left,
        height: Math.max(...points.map(([, v]) => v)) - top };
    });
  });
}

export class PdfValidationError extends Error {}

export async function createPreview(formData: unknown): Promise<Uint8Array> {
  const pdf = await loadPartOneTemplate();
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const name of ["Logo Popup", "ATS Popup", "Section C Popup", "Supp Doc Popup"]) {
    for (const widget of form.getFieldMaybe(name)?.acroField.getWidgets() ?? []) {
      widget.setFlag(AnnotationFlags.Hidden); widget.clearFlag(AnnotationFlags.Print);
    }
  }
  for (const key of FORM_FIELD_KEYS) {
    const definition = FORM_FIELDS[key];
    const field = form.getField(definition.pdfField);
    const saved = readFormField(formData, key);
    const value = saved ?? (definition.type === "checkbox" ? false : "");
    try {
      validateFieldValue(key, value);
      if (field instanceof PDFCheckBox && typeof value === "boolean") {
        if (value) field.check(); else field.uncheck();
        // Preserve the template's original boxed on/off appearances.
        if (field.needsAppearancesUpdate()) field.updateAppearances();
        continue;
      }
      if (!(field instanceof PDFTextField) || typeof value !== "string") throw new Error("Unexpected PDF field type.");
      if (definition.multiline) field.enableMultiline();
      field.setText(value);
      const rect = field.acroField.getWidgets()[0].getRectangle();
      let chosen = 0;
      for (let size = 10; size >= 6; size -= .5) {
        if (!value) { chosen = size; break; }
        if (field.isMultiline()) {
          // Bound the work before asking pdf-lib to generate appearances. Its
          // multiline splitter repeatedly scans long remainders and can stall on
          // a large paragraph that will never fit a tiny fixed template cell.
          const maxWidth = rect.width - 5;
          const maxHeight = rect.height - 5;
          const lineHeight = font.heightAtSize(size) * 1.2;
          let lines = 0;
          let fits = true;
          for (const paragraph of value.split(/\r?\n/)) {
            lines++;
            let used = 0;
            for (const token of paragraph.match(/\S+\s*|\s+/g) ?? []) {
              const tokenWidth = font.widthOfTextAtSize(token, size);
              if (tokenWidth > maxWidth) { fits = false; break; }
              if (used + tokenWidth > maxWidth) { lines++; used = tokenWidth; } else used += tokenWidth;
              if (lines * lineHeight > maxHeight) { fits = false; break; }
            }
            if (!fits || lines * lineHeight > maxHeight) { fits = false; break; }
          }
          if (fits) { chosen = size; break; }
        } else if (!/[\r\n]/.test(value) && font.widthOfTextAtSize(value, size) <= rect.width - 5) { chosen = size; break; }
      }
      if (!chosen) throw new Error("Text exceeds this template cell. Shorten it; the two-page export cannot add overflow rows.");
      if (!field.acroField.getDefaultAppearance()) field.acroField.setDefaultAppearance("/Helv 10 Tf 0 g");
      field.setFontSize(chosen);
      field.updateAppearances(font);
    } catch (error) {
      throw new PdfValidationError(`${definition.title}: ${error instanceof Error ? error.message : "Cannot fill this field."}`);
    }
  }
  return pdf.save();
}

let markers: Promise<FormMarker[]> | undefined;
export function loadFormMarkers(): Promise<FormMarker[]> {
  markers ??= loadPartOneTemplate().then(getFormMarkers)
    .catch((error) => { markers = undefined; throw error; });
  return markers;
}
