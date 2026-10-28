import { readFile } from "node:fs/promises";
import { AnnotationFlags, PDFDocument, PDFTextField, StandardFonts } from "pdf-lib";
import { FORM_FIELDS, FORM_FIELD_KEYS, readFormField } from "../shared/form-fields.ts";
import type { FormMarker } from "../shared/form-fields.ts";

// The local template is the source of truth. Cache bytes, never a mutable PDFDocument.
let templateBytes: Promise<Uint8Array> | undefined;
export function loadTemplateBytes(): Promise<Uint8Array> {
  templateBytes ??= readFile(new URL("../database/pdf/templates/Variance_Template.pdf", import.meta.url))
    .catch((error) => { templateBytes = undefined; throw error; });
  return templateBytes;
}

export function getFormMarkers(pdf: PDFDocument): FormMarker[] {
  const pages = pdf.getPages();
  return FORM_FIELD_KEYS.flatMap((key) => {
    const field = pdf.getForm().getTextField(FORM_FIELDS[key].pdfField);
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

export async function createPreview(formData: unknown): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(await loadTemplateBytes());
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const name of ["Logo Popup", "ATS Popup", "Section C Popup", "Supp Doc Popup"]) {
    const field = form.getFieldMaybe(name);
    // Preserve references from the tagged-PDF structure tree. Removing these
    // objects leaves dangling references in this particular Acrobat template.
    for (const widget of field?.acroField.getWidgets() ?? []) {
      widget.setFlag(AnnotationFlags.Hidden);
      widget.clearFlag(AnnotationFlags.Print);
    }
  }
  for (const key of FORM_FIELD_KEYS) {
    const field = form.getFieldMaybe(FORM_FIELDS[key].pdfField);
    if (!(field instanceof PDFTextField)) throw new Error(`Missing template text field: ${FORM_FIELDS[key].pdfField}`);
    const value = readFormField(formData, key);
    field.setText(typeof value === "string" ? value : "");
    // Some template fields inherit /DA, which pdf-lib cannot resize directly.
    if (!field.acroField.getDefaultAppearance()) field.acroField.setDefaultAppearance("/Helv 10 Tf 0 g");
    field.setFontSize(10);
    field.updateAppearances(font);
  }
  return pdf.save();
}

let markers: Promise<FormMarker[]> | undefined;
export function loadFormMarkers(): Promise<FormMarker[]> {
  markers ??= loadTemplateBytes().then((bytes) => PDFDocument.load(bytes)).then(getFormMarkers)
    .catch((error) => { markers = undefined; throw error; });
  return markers;
}
