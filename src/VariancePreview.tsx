import { useEffect, useId, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { getFieldPromptLayout } from "./attention-markers";
import { FORM_FIELDS } from "../shared/form-fields";
import type { Dispatch, SetStateAction } from "react";
import type { FormFieldKey, FormFieldValues, FormMarker } from "../shared/form-fields";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url
).toString();

type EditableForm = {
  fields: FormMarker[];
  values: FormFieldValues;
  onSave: (changes: FormFieldValues) => Promise<void>;
  disabled: boolean;
  changes?: FormFieldValues;
  onChanges?: Dispatch<SetStateAction<FormFieldValues>>;
};

export default function VariancePreview({ url, width, markers = [], label = "PDF document", editableForm, revealField }: {
  url: string;
  width?: number;
  markers?: FormMarker[];
  label?: string;
  editableForm?: EditableForm;
  revealField?: { key: FormFieldKey; version: number } | null;
}) {
  const [pageCount, setPageCount] = useState(0);
  const [pageRatios, setPageRatios] = useState<Record<number, number>>({});
  const [renderedPages, setRenderedPages] = useState<Record<number, string>>({});
  const [containerWidth, setContainerWidth] = useState(400);
  const [zoom, setZoom] = useState("fit");
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [localChanges, setLocalChanges] = useState<FormFieldValues>({});
  const changes = editableForm?.changes ?? localChanges;
  const setChanges = editableForm?.onChanges ?? setLocalChanges;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [focusRequest, setFocusRequest] = useState<{ key: FormFieldKey } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const revealedRef = useRef("");
  const fieldsRef = useRef(new Map<FormFieldKey, HTMLInputElement | HTMLTextAreaElement>());
  const zoomId = useId();
  const inputId = useId();
  const disabled = saving || editableForm?.disabled;
  const dirty = Object.keys(changes).length > 0;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setContainerWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (editing && focusRequest) {
      const field = fieldsRef.current.get(focusRequest.key);
      field?.focus();
      field?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [editing, focusRequest]);

  useEffect(() => {
    if (!revealField) return;
    const token = `${url}:${revealField.version}`;
    if (revealedRef.current === token) return;
    const marker = editableForm?.fields.find((field) => field.key === revealField.key);
    const viewport = viewportRef.current;
    if (!marker || !viewport || renderedPages[marker.page] !== url) return;
    const page = viewport.querySelector<HTMLElement>(`[data-pdf-page="${marker.page}"]`);
    if (!page || !page.clientHeight || !viewport.clientHeight) return;
    // Section C continues onto page 2, where Section D also lives. Reveal the
    // accepted cell after the new canvas renders, keeping the PDF editable.
    viewport.scrollTo({ top: viewport.scrollTop + page.getBoundingClientRect().top - viewport.getBoundingClientRect().top + marker.top * page.clientHeight - 64 });
    revealedRef.current = token;
  }, [url, revealField, editableForm?.fields, renderedPages]);

  async function saveChanges() {
    if (!editableForm || !dirty || disabled) return;
    setSaving(true);
    setSaveError("");
    try {
      await editableForm.onSave(changes);
      setChanges({});
      setEditing(false);
    } catch {
      setSaveError("Your changes were not saved. They are still here; please try again.");
    } finally { setSaving(false); }
  }

  const pageWidth = zoom === "fit" ? Math.max(1, width ?? containerWidth) : 612 * Number(zoom);
  return (
    <div className="variance-pdf-viewer">
      {/* The toolbar is a sibling of the scrolling viewport, so neither axis moves it. */}
      <div className="variance-pdf-toolbar">
        <div className="variance-pdf-toolbar-main">
          <span>{pageCount ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}` : "PDF preview"}</span>
          <div><label htmlFor={zoomId}>Zoom</label><select id={zoomId} value={zoom} onChange={(event) => setZoom(event.target.value)}>
            <option value="fit">Fit width</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option>
          </select></div>
        </div>
        {editableForm && <div className="variance-pdf-edit-tools">
          {!editing ? <><span>Enter or correct your own information.</span><button type="button" className="variance-secondary" disabled={disabled || !pageCount || !editableForm.fields.length} onClick={() => { setEditing(true); setSaveError(""); }}>Edit fields</button></> : <>
            <span>{dirty ? "Unsaved changes" : "Editing supported fields"}</span>
            <button type="button" disabled={disabled || !dirty} onClick={() => void saveChanges()}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" className="variance-secondary" disabled={disabled} onClick={() => { setChanges({}); setSaveError(""); setEditing(false); }}>Discard</button>
          </>}
        </div>}
        {saveError && <p className="variance-pdf-save-error" role="alert">{saveError}</p>}
      </div>
      <div className="variance-pdf-scroll" ref={viewportRef} tabIndex={0} role="region" aria-label={`${label} preview`}>
        <Document key={`${url}-${retry}`} file={url} onLoadSuccess={({ numPages }) => setPageCount(numPages)}
          loading={<p className="variance-pdf-status" role="status">Loading PDF…</p>}
          error={<div className="variance-empty-preview" role="alert"><strong>Preview unavailable</strong><p>We couldn’t load this PDF. Try again or open it in a new tab.</p><button type="button" className="variance-secondary" onClick={() => setRetry((value) => value + 1)}>Retry preview</button></div>}>
          <div className="variance-pdf-pages">
            {Array.from({ length: pageCount }, (_, index) => (
              <div className="variance-page-group" key={index}>
                <p className="variance-page-label">Page {index + 1} of {pageCount}</p>
                <div className="variance-pdf-page" data-pdf-page={index + 1}>
                  <Page pageNumber={index + 1} width={pageWidth} renderTextLayer={false} renderAnnotationLayer={false}
                    onRenderSuccess={() => setRenderedPages((current) => current[index + 1] === url ? current : { ...current, [index + 1]: url })}
                    onLoadSuccess={({ originalWidth, originalHeight }) => {
                      const ratio = originalHeight / originalWidth;
                      setPageRatios((current) => current[index] === ratio ? current : { ...current, [index]: ratio });
                    }} error={<p role="alert">Could not render page {index + 1}.</p>} />
                  {editableForm?.fields.filter((field) => field.page === index + 1 && (editing || FORM_FIELDS[field.key].type === "checkbox")).map((field, fieldIndex) => {
                    const definition = FORM_FIELDS[field.key];
                    const rawValue = changes[field.key] ?? editableForm.values[field.key] ?? "";
                    if (definition.type === "checkbox") return <input key={field.key} type="checkbox" className="variance-pdf-checkbox" aria-label={definition.title}
                      checked={rawValue === true} disabled={disabled} style={{ top: `${field.top * 100}%`, left: `${field.left * 100}%`, width: `${field.width * 100}%`, height: `${field.height * 100}%` }}
                      onChange={(event) => { const checked = event.target.checked; setChanges((current) => ({ ...current, [field.key]: checked })); setEditing(true); }} />;
                    const value = typeof rawValue === "string" ? rawValue : "";
                    const props = {
                      id: `${inputId}-${field.key}-${fieldIndex}`,
                      className: "variance-pdf-field",
                      "aria-label": definition.title,
                      value, disabled, maxLength: 5000,
                      style: { top: `${field.top * 100}%`, left: `${field.left * 100}%`, width: `${field.width * 100}%`, height: `${field.height * 100}%`, fontSize: `${pageWidth / 612 * 10}px` },
                      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                        const next = event.target.value;
                        setChanges((current) => {
                          const updated = { ...current };
                          if (next === (editableForm.values[field.key] ?? "")) delete updated[field.key];
                          else updated[field.key] = next;
                          return updated;
                        });
                      },
                      ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => {
                        if (element) fieldsRef.current.set(field.key, element);
                        else fieldsRef.current.delete(field.key);
                      },
                    };
                    return definition.multiline
                      ? <textarea key={`${field.key}-${fieldIndex}`} {...props} rows={2} />
                      : <input key={`${field.key}-${fieldIndex}`} {...props} type={definition.type === "date" ? "date" : "text"} />;
                  })}
                  {pageRatios[index] && markers.filter((marker) => marker.page === index + 1 && !(typeof changes[marker.key] === "string" && String(changes[marker.key]).trim())).map((marker, markerIndex) => (
                    <button type="button" className={`variance-marker${/^(sectionC\.article|sectionD\.(document|responsible))[2-9]\d*$/.test(marker.key) ? " variance-marker--yellow" : ""}`} key={`${marker.key}-${markerIndex}`}
                      style={getFieldPromptLayout(marker, pageWidth, pageWidth * pageRatios[index])}
                      disabled={!editableForm || disabled} aria-label={marker.label} title={marker.label}
                      onClick={() => { setEditing(true); setFocusRequest({ key: marker.key }); }}>
                      {FORM_FIELDS[marker.key].prompt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Document>
      </div>
    </div>
  );
}
