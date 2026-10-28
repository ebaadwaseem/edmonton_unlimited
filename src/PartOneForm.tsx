import { useId } from "react";
import type { Dispatch, SetStateAction } from "react";
import { FORM_FIELDS, FORM_FIELD_KEYS, readFieldValues } from "../shared/form-fields";
import type { FormFieldKey, FormFieldValues } from "../shared/form-fields";
import type { Draft, RowEvidence } from "../shared/part-one";
import SectionCReferences from "./SectionCReferences";

export default function PartOneForm({ formData, changes, onChanges, onSave, busy, documents }: {
  formData: Draft; changes: FormFieldValues; onChanges: Dispatch<SetStateAction<FormFieldValues>>;
  onSave: (changes: FormFieldValues) => Promise<void>; busy: boolean; documents: { id: string; original_filename: string }[];
}) {
  const id = useId();
  const saved = readFieldValues(formData);
  const dirty = Object.keys(changes).length > 0;
  function change(key: FormFieldKey, value: string | boolean) {
    onChanges((current) => {
      const next = { ...current };
      if (saved[key] === value) delete next[key]; else next[key] = value;
      return next;
    });
  }
  function control(key: FormFieldKey) {
    const field = FORM_FIELDS[key];
    const value = changes[key] ?? saved[key] ?? "";
    const props = { id: `${id}-${key}`, disabled: busy, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(key, event.target.type === "checkbox" ? (event.target as HTMLInputElement).checked : event.target.value) };
    return <div className={`variance-form-control ${field.type === "checkbox" ? "variance-form-check" : ""}`} key={key}>
      <label htmlFor={props.id}>{field.title}</label>
      {field.type === "checkbox" ? <input {...props} type="checkbox" checked={value === true} /> : field.multiline
        ? <textarea {...props} rows={field.section === "C" ? 3 : 2} value={String(value)} maxLength={5000} />
        : <input {...props} type={field.type === "date" ? "date" : "text"} value={String(value)} maxLength={5000} />}
    </div>;
  }
  function evidence(section: "C" | "D", row: number) {
    const data: RowEvidence | undefined = formData[`section${section}Evidence`]?.[row];
    const edited = Object.keys(changes).some((key) => key.startsWith(`section${section}.`) && (key.endsWith(String(row)) || key === "sectionC.code"));
    if (!data || (section === "C" && edited)) return <p className="variance-evidence-note">{section === "C" ? "Manual entry / source verification needed. Indexed search matches alone are not verified attributions." : "Engineering involvement has not yet been assessed for this entry. Ask the assistant to identify the specific development/evaluation work that may constitute engineering. Enter actual responsible names only when known."}</p>;
    return <div className="variance-row-evidence">
      {section === "C" ? <><strong>Reviewed attribution mapping · candidate rank {data.rank}</strong><p>{data.relevance}</p><p>Benchmark: {data.benchmark}</p>
        <p>Exact provision: {data.articleNumber} · {data.referenceLevel ?? "reference level not recorded"}. {data.scope && `Scope: ${data.scope}`}</p>
        {data.statements && <details><summary>Reviewed attribution text</summary>{data.statements.map((statement, i) => <p key={i}>{statement.type} {statement.identifier}: {statement.text}</p>)}</details>}
        {data.citations?.map((source, i) => <p key={i}>{source.type}: {source.documentId ? <a href={`/api/reference-documents/${source.documentId}/pdf#page=${source.page}`} target="_blank" rel="noreferrer">{source.title}{source.edition ? ` · ${source.edition}` : ""}, PDF page {source.page}{source.reference ? ` · ${source.reference}` : ""}</a> : `${source.title}, PDF page ${source.page}`}</p>)}</> : <>
        <strong>{data.status === "recommended" ? "Recommended documentation — not yet a completed report" : "Document name changed — review the recommendation"}</strong>
        <p>{data.technicalIssues}</p><p>Code references: {data.codeReferences}</p><p>Professional involvement: {data.professionalRole}</p>
        <p className="variance-engineering-flag">{data.engineeringAssessment === "potential_engineering" ? "Potential practice of engineering" : data.engineeringAssessment === "professional_review_needed" ? "Professional review needed" : "Engineering involvement not yet assessed"}: {data.engineeringRationale}</p><p>Source: {data.source}</p>
      </>}
    </div>;
  }
  return <div className="variance-part-one-form">
    <div className="variance-part-one-scroll">
      <p className="variance-evidence-note">Use the sections below or edit directly on the PDF. Save updates the same two-page draft. Empty optional fields do not prevent saving.</p>
      {(["A", "B"] as const).map((section) => <details className="variance-form-section" key={section} open={section === "A"}>
        <summary>Section {section} — {section === "A" ? "Applicant information" : "Project and ATS details"}</summary>
        {section === "B" && <p className="variance-evidence-note">The checkbox follows the supplied template's SCC-submission wording. It does not by itself mean the proposal is non-site-specific. ATS and permit details apply where relevant.</p>}
        {FORM_FIELD_KEYS.filter((key) => FORM_FIELDS[key].section === section).map(control)}
      </details>)}
      <details className="variance-form-section" open><summary>Section C — Code justification</summary>
        <p className="variance-evidence-note">Five attribution rows. Use the precise provision and text scope, not an article-wide combination of unrelated attributions. Manual values remain unverified. Use a separate draft for a different code/edition.</p>
        <SectionCReferences />
        {control("sectionC.code")}
        {[1,2,3,4,5].map((row) => <fieldset key={row}><legend>Attribution row {row}</legend>{evidence("C", row)}
          {(["article", "objective", "function", "intent"] as const).map((column) => control(`sectionC.${column}${row}` as FormFieldKey))}
        </fieldset>)}
      </details>
      <details className="variance-form-section" open><summary>Section D — Supporting documentation</summary>
        <p className="variance-evidence-note">Five rows. Recommendations describe supporting work; they do not replace professional analysis or prove that a report has been provided.</p>
        {[1,2,3,4,5].map((row) => <fieldset key={row}><legend>Document row {row}</legend>{evidence("D", row)}
          {documents.length > 0 && <label className="variance-upload-copy">Copy an uploaded PDF name<select disabled={busy} value="" onChange={(event) => { if (event.target.value) change(`sectionD.document${row}` as FormFieldKey, event.target.value); }}>
            <option value="">Choose uploaded PDF…</option>{documents.map((document) => <option key={document.id} value={document.original_filename}>{document.original_filename}</option>)}
          </select></label>}
          {control(`sectionD.document${row}` as FormFieldKey)}{control(`sectionD.responsible${row}` as FormFieldKey)}
        </fieldset>)}
      </details>
      <details className="variance-form-section"><summary>Printed names and signature dates</summary>
        <p className="variance-evidence-note">Enter actual names and dates yourself. Signature fields remain blank and interactive in the exported PDF for signing with an appropriate PDF tool. Saving a printed name is not signing the application.</p>
        {FORM_FIELD_KEYS.filter((key) => FORM_FIELDS[key].section === "signatures").map(control)}
      </details>
    </div>
    <div className="variance-form-save"><span>{dirty ? "Unsaved changes" : "Saved draft values"}</span>
      <button type="button" disabled={busy || !dirty} onClick={() => { void onSave(changes).catch(() => undefined); }}>{busy ? "Working…" : "Save changes"}</button>
      <button className="variance-secondary" type="button" disabled={busy || !dirty} onClick={() => onChanges({})}>Discard</button>
    </div>
  </div>;
}
