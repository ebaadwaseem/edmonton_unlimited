export type AttributionReport = {
  verified: boolean;
  blockers: string[];
  available: { id: string; reference: string; level: string; scope: string; status: string }[];
  provision: { reference: string } | null;
  candidates: {
    id: string; kind: string; statement_label: string; attribution_group: string; verification_status: string;
    source_reference: string; source_scope: string; statement_text: string; source_document_id: string;
    source_title: string; source_edition: string; source_pdf_page_start: number; source_pdf_page_end: number;
    compatibility_status: string; compatibility_basis: string | null;
  }[];
};
