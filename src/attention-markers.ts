import { FORM_FIELDS } from "../shared/form-fields.ts";
import type { FormMarker } from "../shared/form-fields.ts";

// Place a compact prompt inside the right end of the field, at any display scale.
export function getFieldPromptLayout(field: FormMarker, pageWidth: number, pageHeight: number) {
  const fieldWidth = field.width * pageWidth;
  const fieldHeight = field.height * pageHeight;
  const inset = Math.min(2, fieldWidth * .01);
  const label = FORM_FIELDS[field.key].prompt;
  const baseFontSize = Math.min(11, pageWidth / 612 * 9);
  // Size to the label rather than reserving only 30% of narrow table cells.
  // Include the button's padding/border and stay inside the actual PDF field.
  const width = Math.min(fieldWidth - inset * 2, Math.max(24, label.length * baseFontSize * .7 + 10));
  const fontSize = Math.min(baseFontSize, Math.max(1, (width - 8) / (label.length * .7)));
  const height = Math.min(20, fieldHeight * .85);
  return {
    left: (field.left + field.width) * pageWidth - width - inset,
    top: (field.top + field.height / 2) * pageHeight - height / 2,
    width, height, fontSize,
  };
}
