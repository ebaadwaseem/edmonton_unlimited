export type FormFieldDefinition = { pdfField: string; title: string; label: string; prompt: string; section: "A" | "B" | "C" | "D" | "signatures"; type: "text" | "date" | "checkbox"; multiline: boolean };
export const FORM_FIELDS = {
  "applicant.ownerName": {"pdfField": "Owner", "title": "Owner name", "label": "Enter owner name", "prompt": "Fill name", "section": "A", "type": "text", "multiline": false},
  "applicant.representative": {"pdfField": "Owner Rep", "title": "Owner representative", "label": "Enter owner representative", "prompt": "Fill rep", "section": "A", "type": "text", "multiline": false},
  "applicant.mailingAddress": {"pdfField": "Mailing Address", "title": "Mailing address", "label": "Enter mailing address", "prompt": "Fill address", "section": "A", "type": "text", "multiline": true},
  "applicant.requestDate": {"pdfField": "Date of Reqeuest", "title": "Date of request", "label": "Enter date of request", "prompt": "Fill date", "section": "A", "type": "date", "multiline": false},
  "project.sccSubmitted": {"pdfField": "Check Box", "title": "Submitted to SCC for jurisdictional review", "label": "Enter submitted to scc for jurisdictional review", "prompt": "Select", "section": "B", "type": "checkbox", "multiline": false},
  "project.permitNumber": {"pdfField": "Permit", "title": "Permit number (if applicable)", "label": "Enter permit number (if applicable)", "prompt": "Fill permit", "section": "B", "type": "text", "multiline": false},
  "project.municipalAddress": {"pdfField": "Municipal Address", "title": "Municipal address (if applicable)", "label": "Enter municipal address (if applicable)", "prompt": "Fill address", "section": "B", "type": "text", "multiline": true},
  "project.lot": {"pdfField": "Lot", "title": "Lot (ATS)", "label": "Enter lot (ats)", "prompt": "Fill Lot", "section": "B", "type": "text", "multiline": false},
  "project.block": {"pdfField": "Block", "title": "Block (ATS)", "label": "Enter block (ats)", "prompt": "Fill Block", "section": "B", "type": "text", "multiline": false},
  "project.plan": {"pdfField": "Plan", "title": "Plan (ATS)", "label": "Enter plan (ats)", "prompt": "Fill Plan", "section": "B", "type": "text", "multiline": false},
  "project.quarter": {"pdfField": "QTR", "title": "Quarter (ATS)", "label": "Enter quarter (ats)", "prompt": "Fill QTR", "section": "B", "type": "text", "multiline": false},
  "project.section": {"pdfField": "SEC", "title": "Section (ATS)", "label": "Enter section (ats)", "prompt": "Fill SEC", "section": "B", "type": "text", "multiline": false},
  "project.township": {"pdfField": "TWP", "title": "Township (ATS)", "label": "Enter township (ats)", "prompt": "Fill TWP", "section": "B", "type": "text", "multiline": false},
  "project.range": {"pdfField": "RGE", "title": "Range (ATS)", "label": "Enter range (ats)", "prompt": "Fill RGE", "section": "B", "type": "text", "multiline": false},
  "project.meridian": {"pdfField": "MER", "title": "Meridian (ATS)", "label": "Enter meridian (ats)", "prompt": "Fill MER", "section": "B", "type": "text", "multiline": false},
  "sectionC.code": {"pdfField": "Code or Standard", "title": "Applicable code or standard (include edition)", "label": "Enter applicable code or standard (include edition)", "prompt": "Fill code", "section": "C", "type": "text", "multiline": false},
  "sectionC.article1": {"pdfField": "Article(s)", "title": "Article - row 1", "label": "Fill article 1", "prompt": "Article", "section": "C", "type": "text", "multiline": true},
  "sectionC.objective1": {"pdfField": "Objective", "title": "Objective - row 1", "label": "Enter objective - row 1", "prompt": "Fill objective", "section": "C", "type": "text", "multiline": true},
  "sectionC.function1": {"pdfField": "Function", "title": "Function - row 1", "label": "Enter function - row 1", "prompt": "Fill function", "section": "C", "type": "text", "multiline": true},
  "sectionC.intent1": {"pdfField": "Intent statement", "title": "Intent statement - row 1", "label": "Enter intent statement - row 1", "prompt": "Fill intent", "section": "C", "type": "text", "multiline": true},
  "sectionC.article2": {"pdfField": "Article(s)1", "title": "Article - row 2", "label": "Enter article - row 2", "prompt": "Article", "section": "C", "type": "text", "multiline": true},
  "sectionC.objective2": {"pdfField": "Objective1", "title": "Objective - row 2", "label": "Enter objective - row 2", "prompt": "Fill objective", "section": "C", "type": "text", "multiline": true},
  "sectionC.function2": {"pdfField": "Function1", "title": "Function - row 2", "label": "Enter function - row 2", "prompt": "Fill function", "section": "C", "type": "text", "multiline": true},
  "sectionC.intent2": {"pdfField": "Intent statement1", "title": "Intent statement - row 2", "label": "Enter intent statement - row 2", "prompt": "Fill intent", "section": "C", "type": "text", "multiline": true},
  "sectionC.article3": {"pdfField": "Article(s)2", "title": "Article - row 3", "label": "Enter article - row 3", "prompt": "Article", "section": "C", "type": "text", "multiline": true},
  "sectionC.objective3": {"pdfField": "Objective2", "title": "Objective - row 3", "label": "Enter objective - row 3", "prompt": "Fill objective", "section": "C", "type": "text", "multiline": true},
  "sectionC.function3": {"pdfField": "Function2", "title": "Function - row 3", "label": "Enter function - row 3", "prompt": "Fill function", "section": "C", "type": "text", "multiline": true},
  "sectionC.intent3": {"pdfField": "Intent statement2", "title": "Intent statement - row 3", "label": "Enter intent statement - row 3", "prompt": "Fill intent", "section": "C", "type": "text", "multiline": true},
  "sectionC.article4": {"pdfField": "Article(s)3", "title": "Article - row 4", "label": "Enter article - row 4", "prompt": "Article", "section": "C", "type": "text", "multiline": true},
  "sectionC.objective4": {"pdfField": "Objective3", "title": "Objective - row 4", "label": "Enter objective - row 4", "prompt": "Fill objective", "section": "C", "type": "text", "multiline": true},
  "sectionC.function4": {"pdfField": "Function3", "title": "Function - row 4", "label": "Enter function - row 4", "prompt": "Fill function", "section": "C", "type": "text", "multiline": true},
  "sectionC.intent4": {"pdfField": "Intent statement3", "title": "Intent statement - row 4", "label": "Enter intent statement - row 4", "prompt": "Fill intent", "section": "C", "type": "text", "multiline": true},
  "sectionC.article5": {"pdfField": "Article(s)4", "title": "Article - row 5", "label": "Enter article - row 5", "prompt": "Article", "section": "C", "type": "text", "multiline": true},
  "sectionC.objective5": {"pdfField": "Objective4", "title": "Objective - row 5", "label": "Enter objective - row 5", "prompt": "Fill objective", "section": "C", "type": "text", "multiline": true},
  "sectionC.function5": {"pdfField": "Function4", "title": "Function - row 5", "label": "Enter function - row 5", "prompt": "Fill function", "section": "C", "type": "text", "multiline": true},
  "sectionC.intent5": {"pdfField": "Intent statement4", "title": "Intent statement - row 5", "label": "Enter intent statement - row 5", "prompt": "Fill intent", "section": "C", "type": "text", "multiline": true},
  "sectionD.document1": {"pdfField": "Supporting Doc", "title": "Supporting documentation - row 1", "label": "Enter supporting documentation - row 1", "prompt": "Fill document", "section": "D", "type": "text", "multiline": true},
  "sectionD.responsible1": {"pdfField": "Name Responsible", "title": "Responsible person or organization - row 1", "label": "Enter responsible person or organization - row 1", "prompt": "Fill name", "section": "D", "type": "text", "multiline": true},
  "sectionD.document2": {"pdfField": "Supporting Doc2", "title": "Supporting documentation - row 2", "label": "Enter supporting documentation - row 2", "prompt": "Fill document", "section": "D", "type": "text", "multiline": true},
  "sectionD.responsible2": {"pdfField": "Name Responsible2", "title": "Responsible person or organization - row 2", "label": "Enter responsible person or organization - row 2", "prompt": "Fill name", "section": "D", "type": "text", "multiline": true},
  "sectionD.document3": {"pdfField": "Supporting Doc3", "title": "Supporting documentation - row 3", "label": "Enter supporting documentation - row 3", "prompt": "Fill document", "section": "D", "type": "text", "multiline": true},
  "sectionD.responsible3": {"pdfField": "Name Responsible3", "title": "Responsible person or organization - row 3", "label": "Enter responsible person or organization - row 3", "prompt": "Fill name", "section": "D", "type": "text", "multiline": true},
  "sectionD.document4": {"pdfField": "Supporting Doc4", "title": "Supporting documentation - row 4", "label": "Enter supporting documentation - row 4", "prompt": "Fill document", "section": "D", "type": "text", "multiline": true},
  "sectionD.responsible4": {"pdfField": "Name Responsible4", "title": "Responsible person or organization - row 4", "label": "Enter responsible person or organization - row 4", "prompt": "Fill name", "section": "D", "type": "text", "multiline": true},
  "sectionD.document5": {"pdfField": "Supporting Doc5", "title": "Supporting documentation - row 5", "label": "Enter supporting documentation - row 5", "prompt": "Fill document", "section": "D", "type": "text", "multiline": true},
  "sectionD.responsible5": {"pdfField": "Name Responsible5", "title": "Responsible person or organization - row 5", "label": "Enter responsible person or organization - row 5", "prompt": "Fill name", "section": "D", "type": "text", "multiline": true},
  "signatures.ownerDate": {"pdfField": "Date1", "title": "Owner signature date", "label": "Enter owner signature date", "prompt": "Fill date", "section": "signatures", "type": "date", "multiline": false},
  "signatures.representativeDate": {"pdfField": "Date2", "title": "Representative signature date", "label": "Enter representative signature date", "prompt": "Fill date", "section": "signatures", "type": "date", "multiline": false},
  "signatures.ownerPrintedName": {"pdfField": "Owner Print", "title": "Owner printed name", "label": "Enter owner printed name", "prompt": "Fill name", "section": "signatures", "type": "text", "multiline": false},
  "signatures.representativePrintedName": {"pdfField": "Owner Rep Print", "title": "Representative printed name", "label": "Enter representative printed name", "prompt": "Fill name", "section": "signatures", "type": "text", "multiline": false},
} as const satisfies Record<string, FormFieldDefinition>;
export type FormFieldKey = keyof typeof FORM_FIELDS;
export const FORM_FIELD_KEYS = Object.keys(FORM_FIELDS) as FormFieldKey[];
export const AGENT_FIELD_KEYS = FORM_FIELD_KEYS.filter((key) => FORM_FIELDS[key].section !== "C" && FORM_FIELDS[key].type !== "checkbox" && FORM_FIELDS[key].section !== "signatures");
export function isFormFieldKey(value: unknown): value is FormFieldKey {
  return typeof value === "string" && Object.hasOwn(FORM_FIELDS, value);
}
export function readFormField(form: unknown, key: FormFieldKey): unknown {
  return key.split(".").reduce<unknown>((value, part) => value && typeof value === "object" && Object.hasOwn(value, part) ? (value as Record<string, unknown>)[part] : undefined, form);
}
export type FormMarker = { key: FormFieldKey; label: string; page: number; left: number; top: number; width: number; height: number };
export type FormFieldValues = Partial<Record<FormFieldKey, string | boolean>>;
export function validateFieldValue(key: FormFieldKey, value: unknown) {
  const field = FORM_FIELDS[key];
  if (field.type === "checkbox") {
    if (typeof value !== "boolean") throw new Error(`${field.title} must be true or false.`);
  } else {
    if (typeof value !== "string" || value.length > 5000) throw new Error(`${field.title} must be text of at most 5000 characters.`);
    if (field.type === "date" && value !== "") {
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value)
        throw new Error(`${field.title} must be a valid YYYY-MM-DD date.`);
    }
  }
}
export function applyFormFieldValues<T extends object>(form: T, changes: FormFieldValues): T {
  const updated = { ...form } as Record<string, unknown>;
  for (const [key, value] of Object.entries(changes)) {
    if (!isFormFieldKey(key)) throw new Error("Unsupported form edit.");
    validateFieldValue(key, value);
    const [section, field] = key.split(".");
    const existing = updated[section];
    updated[section] = { ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}), [field]: value };
  }
  return updated as T;
}
export function readFieldValues(form: unknown): FormFieldValues {
  return Object.fromEntries(FORM_FIELD_KEYS.map((key) => {
    const value = readFormField(form, key);
    return [key, FORM_FIELDS[key].type === "checkbox" ? value === true : typeof value === "string" ? value : ""];
  }));
}
