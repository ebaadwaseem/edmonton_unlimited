import { lazy, Suspense, useEffect, useRef, useState } from "react";
import "./VarianceWorkspace.css";
import { readFormField } from "../shared/form-fields";
import type { FormMarker } from "../shared/form-fields";

const VariancePreview = lazy(() => import("./VariancePreview"));

type ApplicationFormData = {
    applicant?: {
        ownerName?: string;
        representative?: string;
        mailingAddress?: string;
    };
    project?: {
        municipalAddress?: string;
        permitNumber?: string;
        jurisdictionWide?: boolean;
    };
    codeArticles?: unknown[];
    supportingDocuments?: unknown[];
};

type Application = {
    id: string;
    title: string;
    form_data: ApplicationFormData;
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

async function api<T>(
    path: string,
    options?: RequestInit
): Promise<T> {
    const response = await fetch(path, options);

    if (!response.ok) {
        const body = await response.json().catch(() => null);

        throw new Error(
            body?.error ?? `Request failed with status ${response.status}`
        );
    }

    return response.json() as Promise<T>;
}

export default function VarianceWorkspace() {
    const [application, setApplication] =
        useState<Application | null>(null);

    const [messages, setMessages] = useState<Message[]>([]);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [documents, setDocuments] = useState<UploadedDocument[]>([]);

    const [markers, setMarkers] = useState<FormMarker[]>([]);

    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [previewVersion, setPreviewVersion] = useState(0);

    const [pageWidth, setPageWidth] = useState(620);

    const previewRef = useRef<HTMLDivElement>(null);

    const applicationId = application?.id;

    useEffect(() => {
        const element = previewRef.current;

        if (!element) return;

        const observer = new ResizeObserver(([entry]) => {
            setPageWidth(Math.max(260, Math.min(entry.contentRect.width, 760)));
        });

        observer.observe(element);

        return () => observer.disconnect();
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

    async function refreshApplication(id: string) {
        const [applicationResult, suggestionResult, documentResult] =
            await Promise.all([
                api<ApplicationResponse>(`/api/applications/${id}`),
                api<Suggestion[]>(`/api/applications/${id}/suggestions`),
                api<UploadedDocument[]>(`/api/applications/${id}/documents`),
            ]);

        setApplication(applicationResult.application);
        setMessages(applicationResult.messages);
        setSuggestions(suggestionResult);
        setDocuments(documentResult);
    }

    async function createApplication() {
        setBusy(true);
        setError("");

        try {
            const created = await api<Application>("/api/applications", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    title: "Variance application",
                    jurisdiction: "Alberta",
                }),
            });

            await refreshApplication(created.id);
            setPreviewVersion((value) => value + 1);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not start.");
        } finally {
            setBusy(false);
        }
    }

    async function uploadDocument(file: File) {
        if (!applicationId) return;

        setBusy(true);
        setError("");

        try {
            const body = new FormData();
            body.append("file", file);

            await api(`/api/applications/${applicationId}/documents`, {
                method: "POST",
                body,
            });

            await refreshApplication(applicationId);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed.");
        } finally {
            setBusy(false);
        }
    }

    async function sendMessage(event: React.FormEvent) {
        event.preventDefault();

        if (!applicationId || !message.trim()) return;

        const text = message.trim();

        setBusy(true);
        setError("");

        try {
            await api(`/api/applications/${applicationId}/messages`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ message: text }),
            });

            setMessage("");
            await refreshApplication(applicationId);
        } catch (err) {
            // The backend saves the user message before running the agent.
            await refreshApplication(applicationId).catch(() => undefined);
            setError(err instanceof Error ? err.message : "Message failed.");
        } finally {
            setBusy(false);
        }
    }

    async function reviewSuggestion(
        suggestionId: string,
        action: "accept" | "reject"
    ) {
        if (!applicationId) return;

        setBusy(true);
        setError("");

        try {
            await api(
                `/api/applications/${applicationId}/suggestions/${suggestionId}/review`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ action }),
                }
            );

            await refreshApplication(applicationId);

            // Reload the PDF after accepted form data changes.
            setPreviewVersion((value) => value + 1);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Review failed.");
        } finally {
            setBusy(false);
        }
    }

    const pendingSuggestions = suggestions.filter(
        (suggestion) => suggestion.status === "pending"
    );

    const missingMarkers = application
        ? markers.filter((marker) => {
            const value = readFormField(application.form_data, marker.key);

            // A jurisdiction-wide proposal might not have a site address.
            if (
                marker.key === "project.municipalAddress" &&
                application.form_data.project?.jurisdictionWide
            ) {
                return false;
            }

            return typeof value !== "string" || !value.trim();
        })
        : [];

    const pdfUrl = applicationId
        ? `/api/applications/${applicationId}/preview.pdf?v=${previewVersion}`
        : "";

    return (
        <main className="variance-app">
            <header className="variance-header">
                <div>
                    <span className="variance-eyebrow">Safety codes</span>
                    <h1>Alternative solution workspace</h1>
                    <p>Prepare and review your variance application.</p>
                </div>

                {application && (
                    <a
                        className="variance-download"
                        href={pdfUrl}
                        target="_blank"
                        rel="noreferrer"
                    >
                        Open PDF draft
                    </a>
                )}
            </header>

            {error && (
                <div className="variance-error" role="alert">
                    {error}
                </div>
            )}

            <div className="variance-layout">
                <section className="variance-panel">
                    <div className="variance-section-heading">
                        <div>
                            <span className="variance-step">01</span>
                            <h2>Your project</h2>
                        </div>
                        <p>Share a document and tell the assistant about your project.</p>
                    </div>

                    {!application ? (
                        <div className="variance-start">
                            <p>Start a draft to upload documents and chat.</p>
                            <button
                                type="button"
                                onClick={createApplication}
                                disabled={busy}
                            >
                                {busy ? "Starting…" : "Start application"}
                            </button>
                        </div>
                    ) : (
                        <>
                            <label className="variance-upload">
                                <strong>Upload a project PDF</strong>
                                <span>PDF up to 25 MB</span>
                                <input
                                    type="file"
                                    accept="application/pdf"
                                    disabled={busy}
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];

                                        if (file) {
                                            void uploadDocument(file);
                                        }

                                        event.target.value = "";
                                    }}
                                />
                            </label>

                            {documents.length > 0 && (
                                <div className="variance-documents">
                                    <span className="variance-label">Uploaded</span>
                                    {documents.map((document) => (
                                        <div key={document.id}>
                                            {document.original_filename}
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="variance-chat">
                                {messages.length === 0 ? (
                                    <p className="variance-muted">
                                        Describe your project or ask the assistant to inspect
                                        an uploaded document.
                                    </p>
                                ) : (
                                    messages.map((item) => (
                                        <div
                                            className={`variance-message variance-message--${item.role}`}
                                            key={item.id}
                                        >
                                            <strong>
                                                {item.role === "user" ? "You" : "Assistant"}
                                            </strong>
                                            <p>{item.content}</p>
                                        </div>
                                    ))
                                )}
                            </div>

                            <form onSubmit={sendMessage} className="variance-compose">
                                <label htmlFor="project-message">Project details</label>

                                <textarea
                                    id="project-message"
                                    value={message}
                                    onChange={(event) => setMessage(event.target.value)}
                                    placeholder="Describe your project or ask a question..."
                                    rows={4}
                                    disabled={busy}
                                />

                                <button
                                    type="submit"
                                    disabled={busy || !message.trim()}
                                >
                                    {busy ? "Working…" : "Send to assistant"}
                                </button>
                            </form>

                            {pendingSuggestions.length > 0 && (
                                <div className="variance-suggestions">
                                    <h3>Suggestions to review</h3>

                                    {pendingSuggestions.map((suggestion) => (
                                        <div
                                            className="variance-suggestion"
                                            key={suggestion.id}
                                        >
                                            <span className="variance-label">
                                                {suggestion.field_key}
                                            </span>
                                            <strong>{suggestion.suggested_value}</strong>
                                            <p>{suggestion.explanation}</p>

                                            <div className="variance-actions">
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void reviewSuggestion(suggestion.id, "accept")
                                                    }
                                                >
                                                    Accept
                                                </button>

                                                <button
                                                    type="button"
                                                    className="variance-secondary"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void reviewSuggestion(suggestion.id, "reject")
                                                    }
                                                >
                                                    Reject
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </section>

                <section className="variance-panel variance-preview-panel">
                    <div className="variance-section-heading">
                        <div>
                            <span className="variance-step">02</span>
                            <h2>Application preview</h2>
                        </div>

                        <p>
                            Highlighted fields need attention.
                        </p>
                    </div>

                    <div className="variance-preview-wrap" ref={previewRef}>
                        {!application ? (
                            <div className="variance-empty-preview">
                                Your application preview will appear here.
                            </div>
                        ) : (
                            <Suspense fallback={<p>Loading PDF viewer…</p>}>
                                <VariancePreview url={pdfUrl} width={pageWidth} markers={missingMarkers} />
                            </Suspense>
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
}