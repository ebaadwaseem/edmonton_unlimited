import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import "./VarianceWorkspace.css";
import PartOneForm from "./PartOneForm";
import WorkspaceIcon from "./WorkspaceIcon";
import { applyFormFieldValues, FORM_FIELDS, isFormFieldKey, readFormField, readFieldValues } from "../shared/form-fields";
import type { FormFieldKey, FormFieldValues, FormMarker } from "../shared/form-fields";
import { api, post } from "./api";
import { SubmissionPanel } from "./ReviewerWorkspace";
import { workflowLabels } from "../shared/review";
import type { WorkflowStatus } from "../shared/review";
import { readDemoSelection, saveDemoSelection } from "./demo-state";

const VariancePreview = lazy(() => import("./VariancePreview"));
const panels = ["documents", "conversation", "application"] as const;
type Panel = typeof panels[number];
const panelLabels = { documents: "Documents", conversation: "Conversation", application: "Application" };

type ApplicationFormData = Record<string, any>;

type Application = {
    id: string;
    title: string;
    form_data: ApplicationFormData;
    workflow_status: WorkflowStatus;
    latest_submission_id: string | null;
};

type Message = {
    id: string;
    role: "user" | "assistant";
    content: string;
};

type Suggestion = {
    id: string;
    field_key: string;
    suggested_value: string;
    explanation: string;
    metadata?: Record<string, any>;
    status: "pending" | "accepted" | "rejected";
};

type UploadedDocument = {
    id: string;
    original_filename: string;
};

type ApplicationResponse = {
    application: Application;
    messages: Message[];
};

export default function VarianceWorkspace() {
    const [application, setApplication] = useState<Application | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [documents, setDocuments] = useState<UploadedDocument[]>([]);
    const [selectedDocumentId, setSelectedDocumentId] = useState("");
    const [manualEdits, setManualEdits] = useState<FormFieldValues>({});
    const [formView, setFormView] = useState(false);
    const [markers, setMarkers] = useState<FormMarker[]>([]);
    const [message, setMessage] = useState("");
    const [activity, setActivity] = useState<"create" | "upload" | "message" | "review" | "save" | "submit" | "load" | "delete" | null>("load");
    const [deletePrompt, setDeletePrompt] = useState(false);
    const [savedApplications, setSavedApplications] = useState<Application[]>([]);
    const [projectTitle, setProjectTitle] = useState("Variance application");
    const [showSubmission, setShowSubmission] = useState(false);
    const [error, setError] = useState("");
    const [previewVersion, setPreviewVersion] = useState(0);
    const [acceptedField, setAcceptedField] = useState<{ key: FormFieldKey; version: number } | null>(null);
    const [documentsOpen, setDocumentsOpen] = useState(false);
    const [activePanel, setActivePanel] = useState<Panel>("conversation");
    const chatRef = useRef<HTMLDivElement>(null);
    const messageRef = useRef<HTMLTextAreaElement>(null);
    const followConversation = useRef(true);
    const busy = activity !== null;
    const applicationId = application?.id;
    const selectedDocument = documents.find((document) => document.id === selectedDocumentId);

    useLayoutEffect(() => {
        const textarea = messageRef.current;
        if (!textarea) return;
        const resize = () => {
            textarea.style.height = "auto";
            textarea.style.height = `${textarea.scrollHeight + 2}px`;
        };
        resize();
        let previousWidth = textarea.clientWidth;
        const observer = new ResizeObserver(() => {
            if (textarea.clientWidth === previousWidth) return;
            previousWidth = textarea.clientWidth;
            resize();
        });
        observer.observe(textarea);
        return () => observer.disconnect();
    }, [message, activePanel, showSubmission]);

    useEffect(() => {
        const controller = new AbortController();
        void api<Application[]>("/api/applications", { signal: controller.signal }).then(async (saved) => {
            setSavedApplications(saved);
            const previous = readDemoSelection("application");
            if (saved.some((item) => item.id === previous)) await refreshApplication(previous, controller.signal);
        }).catch((err) => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setActivity(null); });
        return () => controller.abort();
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void api<FormMarker[]>("/api/template/fields", { signal: controller.signal })
            .then(setMarkers)
            .catch((err: unknown) => {
                if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load template fields.");
            });
        return () => controller.abort();
    }, []);

    useEffect(() => {
        const chat = chatRef.current;
        if (chat && followConversation.current) chat.scrollTop = chat.scrollHeight;
    }, [messages, activity]);

    async function refreshApplication(id: string, signal?: AbortSignal) {
        const [applicationResult, suggestionResult, documentResult] = await Promise.all([
            api<ApplicationResponse>(`/api/applications/${id}`, { signal }),
            api<Suggestion[]>(`/api/applications/${id}/suggestions`, { signal }),
            api<UploadedDocument[]>(`/api/applications/${id}/documents`, { signal }),
        ]);
        setApplication(applicationResult.application);
        saveDemoSelection("application",id);
        setMessages(applicationResult.messages);
        setSuggestions(suggestionResult);
        setDocuments(documentResult);
        setSelectedDocumentId((current) => documentResult.some((document) => document.id === current) ? current : documentResult[0]?.id ?? "");
    }

    async function ensureApplication() {
        if (application) return application;
        const created = await api<Application>("/api/applications", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: projectTitle.trim() || "Variance application", jurisdiction: "Alberta" }),
        });
        setApplication(created);
        saveDemoSelection("application",created.id);
        setSavedApplications((current) => [created, ...current]);
        setPreviewVersion((value) => value + 1);
        return created;
    }

    async function createApplication() {
        if (busy) return;
        setActivity("create");
        setError("");
        try {
            const created = await ensureApplication();
            await refreshApplication(created.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not start.");
        } finally { setActivity(null); }
    }

    async function openApplication(id: string) {
        if (!id || busy || Object.keys(manualEdits).length) return;
        setDeletePrompt(false);
        setActivity("load"); setError("");
        try { await refreshApplication(id); setAcceptedField(null); setPreviewVersion((value) => value + 1); }
        catch (err) { setError(err instanceof Error ? err.message : "Could not open saved draft."); }
        finally { setActivity(null); }
    }

    async function submitForReview() {
        if (!applicationId || busy || Object.keys(manualEdits).length) return;
        setDeletePrompt(false);
        setActivity("submit"); setError("");
        try {
            await post(`/api/applications/${applicationId}/submit`, {});
            await refreshApplication(applicationId);
            setSavedApplications(await api<Application[]>("/api/applications"));
            setShowSubmission(true);
        } catch (err) { setError(err instanceof Error ? err.message : "Could not submit for review."); }
        finally { setActivity(null); }
    }

    async function deleteDraft() {
        if (!applicationId || busy || application.latest_submission_id || application.workflow_status !== "draft") return;
        setActivity("delete"); setError("");
        try {
            await api(`/api/applications/${applicationId}`, { method: "DELETE" });
            setSavedApplications((current) => current.filter((saved) => saved.id !== applicationId));
            setApplication(null); setMessages([]); setSuggestions([]); setDocuments([]);
            saveDemoSelection("application","");
            setManualEdits({}); setAcceptedField(null); setSelectedDocumentId("");
            setMessage(""); setProjectTitle("Variance application"); setDeletePrompt(false);
            setDocumentsOpen(false); setFormView(false);
            requestAnimationFrame(() => document.getElementById("new-project-title")?.focus());
        } catch (err) { setError(err instanceof Error ? err.message : "Could not delete draft."); }
        finally { setActivity(null); }
    }

    async function uploadDocument(file: File) {
        if (busy) return;
        setActivity("upload");
        setError("");
        try {
            const draft = await ensureApplication();
            const body = new FormData();
            body.append("file", file);
            const uploaded = await api<UploadedDocument>(`/api/applications/${draft.id}/documents`, { method: "POST", body });
            await refreshApplication(draft.id);
            setSelectedDocumentId(uploaded.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed.");
        } finally { setActivity(null); }
    }

    async function sendMessage(event: React.FormEvent) {
        event.preventDefault();
        if (!applicationId || !message.trim() || busy) return;
        const submittedMessage = message.trim();
        setMessage("");
        setActivity("message");
        setError("");
        followConversation.current = true;
        try {
            await api(`/api/applications/${applicationId}/messages`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: submittedMessage }),
            });
            await refreshApplication(applicationId);
        } catch (err) {
            // The backend saves the user message before running the agent.
            await refreshApplication(applicationId).catch(() => undefined);
            setError(err instanceof Error ? err.message : "Message failed.");
        } finally { setActivity(null); }
    }

    async function reviewSuggestion(suggestionId: string, action: "accept" | "reject") {
        if (!applicationId) return;
        setActivity("review");
        setError("");
        try {
            const reviewed = await api<{ suggestion: Suggestion; application?: Application }>(`/api/applications/${applicationId}/suggestions/${suggestionId}/review`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
            });
            setSuggestions((current) => current.map((suggestion) => suggestion.id === suggestionId ? reviewed.suggestion : suggestion));
            if (action === "accept" && reviewed.application) {
                const savedApplication = reviewed.application;
                setApplication((current) => current ? { ...current, ...savedApplication } : savedApplication);
                setPreviewVersion((value) => value + 1);
                if (isFormFieldKey(reviewed.suggestion.field_key)) {
                    const key = reviewed.suggestion.field_key;
                    setAcceptedField((current) => ({ key, version: (current?.version ?? 0) + 1 }));
                }
            }
            await refreshApplication(applicationId);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Review failed.");
        } finally { setActivity(null); }
    }

    async function saveFormFields(changes: FormFieldValues) {
        if (!application) throw new Error("Start an application before editing the form.");
        setActivity("save");
        setError("");
        try {
            const saved = await api<Application>(`/api/applications/${application.id}/form`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ formData: applyFormFieldValues(application.form_data, changes) }),
            });
            setApplication((current) => current ? { ...current, form_data: saved.form_data } : current);
            setManualEdits({});
            setPreviewVersion((value) => value + 1);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save form changes.");
            throw err;
        } finally { setActivity(null); }
    }

    function closeDocuments() {
        setDocumentsOpen(false);
        document.getElementById("documents-drawer-toggle")?.focus();
    }

    function navigatePanels(event: KeyboardEvent<HTMLButtonElement>, panel: Panel) {
        let index = panels.indexOf(panel);
        if (event.key === "ArrowRight") index = (index + 1) % panels.length;
        else if (event.key === "ArrowLeft") index = (index + panels.length - 1) % panels.length;
        else if (event.key === "Home") index = 0;
        else if (event.key === "End") index = panels.length - 1;
        else return;
        event.preventDefault();
        setActivePanel(panels[index]);
        document.getElementById(`tab-${panels[index]}`)?.focus();
    }

    const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === "pending");
    const missingMarkers = application ? markers.filter((marker) => {
        const value = readFormField(application.form_data, marker.key);
        if (FORM_FIELDS[marker.key].type === "checkbox") return false;
        if (marker.key === "project.municipalAddress" && application.form_data.project?.jurisdictionWide) return false;
        return typeof value !== "string" || !value.trim();
    }) : [];
    const fieldValues = readFieldValues(application?.form_data);
    const pdfUrl = applicationId ? `/api/applications/${applicationId}/preview.pdf?v=${previewVersion}` : "";
    const documentUrl = applicationId && selectedDocument ? `/api/applications/${applicationId}/documents/${selectedDocument.id}/pdf` : "";

    if (showSubmission && application?.latest_submission_id) return <main className="applicant-feedback">
        <button type="button" onClick={() => { setShowSubmission(false); void openApplication(application.id); }}>Back to working draft</button>
        <SubmissionPanel key={application.latest_submission_id} submissionId={application.latest_submission_id} />
    </main>;

    return (
        <main className="variance-app">
            <div className="applicant-workflow">
                <label htmlFor="saved-application">Saved applications</label><select id="saved-application" value={applicationId ?? ""} disabled={busy || Object.keys(manualEdits).length > 0} onChange={(event) => void openApplication(event.target.value)}>
                    <option value="">Choose a draft…</option>{savedApplications.map((saved) => <option key={saved.id} value={saved.id}>{saved.title} · {workflowLabels[saved.workflow_status]}</option>)}
                </select>
                {!application && <><label htmlFor="new-project-title">Project title</label><input id="new-project-title" value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} maxLength={200} disabled={busy} /></>}
                {application && <><strong>{application.title}</strong><span className="variance-badge">{workflowLabels[application.workflow_status]}</span>
                    <button type="button" disabled={busy || Object.keys(manualEdits).length > 0 || application.workflow_status === "submitted"} onClick={() => void submitForReview()}>{activity === "submit" ? "Submitting…" : application.latest_submission_id ? "Submit revised application" : "Submit for review"}</button>
                    {application.latest_submission_id && <button type="button" disabled={busy} className="variance-secondary" onClick={() => { void refreshApplication(application.id).then(() => setShowSubmission(true)).catch((err) => setError(err.message)); }}>Submitted snapshot / reviewer feedback</button>}
                    <button type="button" disabled={busy || Object.keys(manualEdits).length > 0} className="variance-secondary" onClick={() => { saveDemoSelection("application",""); setDeletePrompt(false); setApplication(null); setMessages([]); setSuggestions([]); setDocuments([]); setManualEdits({}); setAcceptedField(null); setProjectTitle("Variance application"); }}>New draft</button>
                    {application.workflow_status === "draft" && !application.latest_submission_id && <button id="delete-draft-toggle" type="button" className="variance-secondary variance-delete-draft" disabled={busy} onClick={() => { setDeletePrompt(true); requestAnimationFrame(() => document.getElementById("cancel-delete-draft")?.focus()); }}>Delete draft</button>}
                    <p>{Object.keys(manualEdits).length ? "Save or discard your form edits before submitting or changing applications." : application.latest_submission_id ? "You are editing the working draft. Reviewers see the frozen submitted revision. A revised submission is available after changes are requested or review is complete." : "Pressing submit sends the application for review. Submitting does not mean application is approved."}</p>
                </>}
            </div>
            {deletePrompt && application && <section className="variance-delete-confirm" role="alertdialog" aria-labelledby="delete-draft-title" aria-describedby="delete-draft-description" onKeyDown={(event) => { if (event.key === "Escape" && !busy) { setDeletePrompt(false); document.getElementById("delete-draft-toggle")?.focus(); } }}>
                <h2 id="delete-draft-title">Delete “{application.title}”?</h2>
                <p id="delete-draft-description">This permanently removes this draft, its saved answers, conversation, suggestions and uploaded PDFs, including any unsaved form edits. This cannot be undone.</p>
                <div className="review-buttons"><button id="cancel-delete-draft" type="button" className="variance-secondary" disabled={busy} onClick={() => { setDeletePrompt(false); document.getElementById("delete-draft-toggle")?.focus(); }}>Keep draft</button><button type="button" className="variance-delete-draft" disabled={busy} onClick={() => void deleteDraft()}>{activity === "delete" ? "Deleting…" : "Permanently delete draft"}</button></div>
            </section>}
            {/* <header className="variance-header">
                <div className="variance-brand">
                    <span className="variance-brand-mark" aria-hidden="true">V<span>.</span></span>
                    <div>
                        <span className="variance-eyebrow">Safety codes · Project workspace</span>
                        <h1>Alternative solution workspace</h1>
                    </div>
                </div>

            </header> */}

            {error && <div className="variance-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>Dismiss</button></div>}

            <div className="variance-panel-tabs" role="tablist" aria-label="Workspace panels">
                {panels.map((panel) => <button key={panel} id={`tab-${panel}`} type="button" role="tab" aria-selected={activePanel === panel}
                    aria-controls={`panel-${panel}`} tabIndex={activePanel === panel ? 0 : -1} onKeyDown={(event) => navigatePanels(event, panel)} onClick={() => setActivePanel(panel)}>
                    <WorkspaceIcon name={panel} />{panelLabels[panel]}
                    {panel === "conversation" && pendingSuggestions.length > 0 && <span className="variance-count">{pendingSuggestions.length}</span>}
                </button>)}
            </div>

            <div className="variance-layout">
                <aside className="variance-documents-rail" aria-label="Project document drawer">
                    <button id="documents-drawer-toggle" type="button" aria-expanded={documentsOpen} aria-controls="panel-documents"
                        aria-label={`${documentsOpen ? "Close" : "Open"} project documents (${documents.length} uploaded)`}
                        title="Project documents" onClick={() => {
                            if (documentsOpen) closeDocuments();
                            else {
                                setDocumentsOpen(true);
                                requestAnimationFrame(() => document.getElementById("documents-drawer-close")?.focus());
                            }
                        }}>
                        <WorkspaceIcon name="documents" /><span className="variance-rail-label">Project documents</span><span className="variance-count">{documents.length}</span>
                    </button>
                </aside>
                <section className="variance-panel variance-documents-panel" id="panel-documents" role="region" data-open={documentsOpen} onKeyDown={(event) => { if (event.key === "Escape" && documentsOpen) { event.stopPropagation(); closeDocuments(); } }} data-active={activePanel === "documents"} aria-labelledby="documents-heading">
                    <div className="variance-panel-heading">
                        <div className="variance-heading-line"><span className="variance-panel-icon"><WorkspaceIcon name="documents" /></span><h2 id="documents-heading">Project documents</h2><span className="variance-count">{documents.length}</span><button id="documents-drawer-close" className="variance-secondary variance-documents-close" type="button" onClick={closeDocuments}>Close <span aria-hidden="true">×</span></button></div>
                        <p>Your drawings, plans, and supporting PDFs.</p>
                    </div>
                    <div className="variance-document-controls">
                        <label className="variance-upload" data-disabled={busy}>
                            <WorkspaceIcon name="upload" />
                            <span><strong>{activity === "upload" ? "Uploading PDF…" : "Upload a project PDF"}</strong><span id="upload-description">Choose a PDF · up to 25 MB</span></span>
                            <input className="variance-file-input" type="file" accept="application/pdf,.pdf" disabled={busy} aria-describedby="upload-description"
                                onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadDocument(file); event.target.value = ""; }} />
                        </label>
                        {documents.length > 0 && <div className="variance-document-selector">
                            <label htmlFor="project-document">Document to preview</label>
                            <select id="project-document" value={selectedDocumentId} onChange={(event) => setSelectedDocumentId(event.target.value)}>
                                {documents.map((document) => <option key={document.id} value={document.id}>{document.original_filename}</option>)}
                            </select>
                            {selectedDocument && <a href={documentUrl} target="_blank" rel="noreferrer">Open selected PDF <WorkspaceIcon name="arrow" /></a>}
                        </div>}
                    </div>
                    <div className="variance-document-preview">
                        {selectedDocument ? <Suspense fallback={<p className="variance-pdf-status" role="status">Loading PDF viewer…</p>}>
                            <VariancePreview key={selectedDocument.id} url={documentUrl} label={selectedDocument.original_filename} />
                        </Suspense> : <div className="variance-empty-preview">
                            <span className="variance-empty-icon"><WorkspaceIcon name="documents" /></span>
                                <h3>Upload a PDF to view it here and discuss it with the assistant.</h3>
                            <p>Choose a drawing, plan, or supporting document to get started.</p>
                            {/* <span className="variance-empty-note">Your original documents stay separate from your application draft.</span> */}
                        </div>}
                    </div>
                </section>

                <section className="variance-panel variance-conversation-panel" id="panel-conversation" role="tabpanel" data-active={activePanel === "conversation"} aria-labelledby="tab-conversation">
                    <div className="variance-panel-heading">
                        <div className="variance-heading-line"><span className="variance-panel-icon"><WorkspaceIcon name="conversation" /></span><h2 id="conversation-heading">Conversation</h2></div>
                        {/* <p>Develop your proposal, one detail at a time.</p> */}
                        {pendingSuggestions.length > 0 && <button className="variance-review-link" type="button" onClick={() => document.getElementById("suggestion-review")?.scrollIntoView({ block: "start" })}>
                            {pendingSuggestions.length} {pendingSuggestions.length === 1 ? "suggestion" : "suggestions"} to review <span aria-hidden="true">↓</span>
                        </button>}
                    </div>
                    <div className="variance-chat variance-panel-scroll" ref={chatRef} tabIndex={0} role="region" aria-label="Conversation history and form suggestions"
                        onScroll={(event) => { const element = event.currentTarget; followConversation.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}>
                        {messages.length === 0 && <div className="variance-conversation-empty">
                            <span className="variance-empty-icon"><WorkspaceIcon name="conversation" /></span>
                            {/* <h3>Let’s work through your proposal</h3> */}
                            <p>Describe your project, ask a code question, or ask the assistant to look at an uploaded PDF.</p>
                            {!application && <button type="button" onClick={createApplication} disabled={busy}>{activity === "create" ? "Starting…" : "Start application"}<span aria-hidden="true"> →</span></button>}

                        </div>}
                        {messages.map((item) => <article className={`variance-message variance-message--${item.role}`} key={item.id}>
                            <div className="variance-message-author"><span className="variance-avatar" aria-hidden="true">{item.role === "user" ? "Y" : "A"}</span><strong>{item.role === "user" ? "You" : "Assistant"}</strong></div>
                            <p>{item.content}</p>
                        </article>)}
                        {activity === "message" && <p className="variance-working" role="status"><span className="variance-pulse" aria-hidden="true" />The assistant is working on your request…</p>}
                        {activity === "review" && <p className="variance-working" role="status">Saving your review…</p>}
                        {pendingSuggestions.length > 0 && <section className="variance-suggestions" id="suggestion-review" aria-labelledby="suggestions-heading">
                            <div className="variance-suggestions-heading"><h3 id="suggestions-heading">Suggested form values</h3><span className="variance-count">{pendingSuggestions.length}</span></div>
                            <p className="variance-muted">Check each value and its source before adding it to your draft.</p>
                            {pendingSuggestions.map((suggestion) => <article className="variance-suggestion" key={suggestion.id}>
                                <span className="variance-label">{isFormFieldKey(suggestion.field_key) ? FORM_FIELDS[suggestion.field_key].title : suggestion.field_key}</span>
                                <strong>{suggestion.suggested_value}</strong><p>{suggestion.explanation}</p>
                                {suggestion.metadata?.kind === "verified_article" && <details className="variance-suggestion-evidence"><summary>Review attribution values and sources</summary>
                                    <p>Reference level: {suggestion.metadata.referenceLevel ?? "unspecified"}. Scope: {suggestion.metadata.scope || "entire identified provision"}.</p>
                                    <p>Accepting adds these values together. If the mapping changes, you’ll need a fresh proposal.</p>
                                    <p>Code: {suggestion.metadata.mapping?.code}</p><p>Objective: {suggestion.metadata.mapping?.objective}</p>
                                    <p>Function: {suggestion.metadata.mapping?.function}</p><p>Intent: {suggestion.metadata.mapping?.intent}</p>
                                    {suggestion.metadata.citations?.map((source: { title: string; page: number }, index: number) => <p key={index}>{source.title}, PDF page {source.page}</p>)}
                                </details>}
                                {suggestion.metadata?.kind === "supporting_document" && <details className="variance-suggestion-evidence"><summary>Review documentation recommendation</summary>
                                    <p>Recommendation only; accepting does not create a completed report or assign a professional.</p>
                                    <p>Code references: {suggestion.metadata.codeReferences}</p>
                                    <p>{suggestion.metadata.engineeringAssessment === "potential_engineering" ? "Potential practice of engineering" : suggestion.metadata.engineeringAssessment === "professional_review_needed" ? "Professional review needed" : "Engineering involvement not assessed"}: {suggestion.metadata.engineeringRationale}</p>
                                    <p>Source: {suggestion.metadata.source}</p>
                                </details>}
                                <div className="variance-actions">
                                    <button type="button" disabled={busy} aria-label={`Accept value for ${isFormFieldKey(suggestion.field_key) ? FORM_FIELDS[suggestion.field_key].title : "this field"}`} onClick={() => void reviewSuggestion(suggestion.id, "accept")}>Accept value</button>
                                    <button type="button" className="variance-secondary" disabled={busy} aria-label={`Reject value for ${isFormFieldKey(suggestion.field_key) ? FORM_FIELDS[suggestion.field_key].title : "this field"}`} onClick={() => void reviewSuggestion(suggestion.id, "reject")}>Reject</button>
                                </div>
                            </article>)}
                        </section>}
                    </div>
                    <form onSubmit={sendMessage} className="variance-compose">
                        <label htmlFor="project-message">Message the assistant</label>
                        <textarea ref={messageRef} id="project-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={application ? "Describe your project or ask a question…" : "Start an application to begin the conversation…"}
                            rows={1} disabled={!application || busy} maxLength={5000} />
                        <div className="variance-compose-footer">
                            <button type="submit" disabled={!application || busy || !message.trim()}>{activity === "message" ? "Working…" : "Send"}<WorkspaceIcon name="send" /></button>
                        </div>
                    </form>
                </section>

                <section className="variance-panel variance-preview-panel" id="panel-application" role="tabpanel" data-active={activePanel === "application"} aria-labelledby="tab-application">
                    <div className="variance-panel-heading">
                        <div className="variance-heading-line"><span className="variance-panel-icon"><WorkspaceIcon name="application" /></span><h2 id="application-heading">Variance application</h2><span className="variance-badge">{application ? workflowLabels[application.workflow_status] : "Draft"}</span></div>
                        {application && <div className="variance-form-note"><span aria-hidden="true" />Select a fill label or Edit fields to add or correct a value.</div>}
                    </div>
                    {application && <div className="variance-application-views" aria-label="Application view">
                        <button type="button" className="variance-secondary" aria-pressed={!formView} onClick={() => setFormView(false)}>PDF preview</button>
                        <button type="button" className="variance-secondary" aria-pressed={formView} onClick={() => setFormView(true)}>Edit Part 1 · A–D</button>
                        {Object.keys(manualEdits).length > 0 && <span>Unsaved changes</span>}
                    </div>}
                    {application && <div className="variance-form-view" style={{ display: formView ? "flex" : "none" }}>
                        <PartOneForm formData={application.form_data} changes={manualEdits} onChanges={setManualEdits} onSave={saveFormFields} busy={busy} documents={documents} />
                    </div>}
                    <div className="variance-preview-wrap" style={{ display: formView ? "none" : "flex" }}>
                        {application ? <Suspense fallback={<p className="variance-pdf-status" role="status">Loading PDF viewer…</p>}>
                            <VariancePreview url={pdfUrl} markers={missingMarkers} revealField={formView ? null : acceptedField} label="Variance application draft" editableForm={{ fields: markers, values: fieldValues, onSave: saveFormFields, disabled: busy, changes: manualEdits, onChanges: setManualEdits }} />
                        </Suspense> : <div className="variance-empty-preview">
                            <span className="variance-empty-icon"><WorkspaceIcon name="application" /></span><h3>From conversation to application</h3>
                            <p>Start a draft to preview the variance form. Values appear here after you accept the assistant’s suggestions.</p>
                            <span className="variance-empty-note">The PDF stays fillable for further editing.</span>
                        </div>}
                    </div>
                    {application && <div className="variance-preview-footer"><span>Editable PDF draft</span><a href={pdfUrl} target="_blank" rel="noreferrer">Open / download PDF <WorkspaceIcon name="arrow" /></a></div>}
                </section>
            </div>
        </main>
    );
}
