import { AGENT_FIELD_KEYS, applyFormFieldValues, isFormFieldKey, validateFieldValue } from "../shared/form-fields.ts";
import { attributionFingerprint, lookupVerifiedAttributions } from "./attributions.ts";
import { invalidateChangedEvidence } from "../shared/part-one.ts";
import type { Draft } from "../shared/part-one.ts";

export async function acceptSuggestedValue(form: Draft, suggestion: Record<string, any>) {
  const { field_key: key, suggested_value: value, metadata = {} } = suggestion;
  if (!isFormFieldKey(key)) throw new Error("Unsupported suggestion field.");
  if (metadata.kind === "verified_article") {
    const row = Number(metadata.row);
    if (!Number.isInteger(row) || row < 1 || row > 5 || key !== `sectionC.article${row}`) throw new Error("Invalid article row.");
    const lookup = await lookupVerifiedAttributions(Number(metadata.documentId), value, metadata.scope ?? "");
    if (!lookup) throw new Error("This article no longer has a complete verified attribution mapping.");
    if (metadata.mappingFingerprint !== attributionFingerprint(lookup)) throw new Error("The reviewed mapping changed since this suggestion. Request a fresh proposal before accepting.");
    const code = [lookup.title, lookup.edition, lookup.jurisdiction].filter(Boolean).join(" · ");
    const occupied = [1,2,3,4,5].some((other) => other !== row && form.sectionC?.[`article${other}`]);
    if (occupied && form.sectionC?.code && form.sectionC.code !== code) throw new Error("The template supports one applicable code per draft. Use a separate draft for a different code/edition.");
    const next = applyFormFieldValues(form, { "sectionC.code": code, [key]: [lookup.reference, lookup.scope].filter(Boolean).join("\n"),
      [`sectionC.objective${row}`]: lookup.objective, [`sectionC.function${row}`]: lookup.function, [`sectionC.intent${row}`]: lookup.intent });
    return { ...next, sectionCEvidence: { ...form.sectionCEvidence, [row]: { ...metadata, verified: true, articleNumber: value, citations: lookup.citations, statements: lookup.statements } } };
  }
  if (metadata.kind === "supporting_document") {
    const row = Number(metadata.row);
    if (!Number.isInteger(row) || row < 1 || row > 5 || key !== `sectionD.document${row}`) throw new Error("Invalid supporting-document row.");
    const next = applyFormFieldValues(form, { [key]: value });
    return { ...next, sectionDEvidence: { ...form.sectionDEvidence, [row]: { ...metadata, status: "recommended" } } };
  }
  if (!AGENT_FIELD_KEYS.includes(key)) throw new Error("This field requires direct user entry or a verified article lookup.");
  validateFieldValue(key, value);
  return invalidateChangedEvidence(form, applyFormFieldValues(form, { [key]: value }));
}
