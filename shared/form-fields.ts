export const FORM_FIELDS = {
  "applicant.ownerName": { pdfField: "Owner", label: "Add owner name" },
  "applicant.representative": { pdfField: "Owner Rep", label: "Add owner representative" },
  "applicant.mailingAddress": { pdfField: "Mailing Address", label: "Add mailing address" },
  "project.municipalAddress": { pdfField: "Municipal Address", label: "Review property address" },
  "project.permitNumber": { pdfField: "Permit", label: "Add permit number" },
} as const;

export type FormFieldKey = keyof typeof FORM_FIELDS;
export const FORM_FIELD_KEYS = Object.keys(FORM_FIELDS) as FormFieldKey[];
export function isFormFieldKey(value: unknown): value is FormFieldKey {
  return typeof value === "string" && Object.hasOwn(FORM_FIELDS, value);
}

export function readFormField(form: unknown, key: FormFieldKey): unknown {
  return key.split(".").reduce<unknown>((value, part) =>
    value && typeof value === "object" && Object.hasOwn(value, part)
      ? (value as Record<string, unknown>)[part] : undefined, form);
}

export type FormMarker = {
  key: FormFieldKey;
  label: string;
  page: number; // Physical page number, starting at 1.
  left: number;
  top: number;
  width: number;
  height: number;
};
