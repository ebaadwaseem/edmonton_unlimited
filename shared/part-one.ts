import { FORM_FIELD_KEYS, readFormField } from "./form-fields.ts";
export type Draft = Record<string, any>;
export type RowEvidence = { verified?: boolean; documentId?: number; articleNumber?: string; referenceLevel?: string; scope?: string; rank?: number; relevance?: string; benchmark?: string; statements?: Array<{ type: string; identifier?: string; text: string }>; citations?: Array<{ documentId?: string | number; title: string; edition?: string; reference?: string; scope?: string; page: number; type: string }>; technicalIssues?: string; codeReferences?: string; professionalRole?: string; engineeringAssessment?: string; engineeringRationale?: string; source?: string; status?: string };

export function invalidateChangedEvidence(current: Draft, proposed: Draft): Draft {
  const next = { ...proposed, sectionCEvidence: { ...(current.sectionCEvidence ?? {}) }, sectionDEvidence: { ...(current.sectionDEvidence ?? {}) } };
  for (let row = 1; row <= 5; row++) {
    const changed = ["article", "objective", "function", "intent"].some((column) =>
      readFormField(current, `sectionC.${column}${row}` as typeof FORM_FIELD_KEYS[number]) !== readFormField(proposed, `sectionC.${column}${row}` as typeof FORM_FIELD_KEYS[number]));
    if (changed || current.sectionC?.code !== proposed.sectionC?.code) delete next.sectionCEvidence[row];
    if (current.sectionD?.[`document${row}`] !== proposed.sectionD?.[`document${row}`] && next.sectionDEvidence[row])
      next.sectionDEvidence[row] = { ...next.sectionDEvidence[row], status: "needs_review" };
  }
  return next;
}
