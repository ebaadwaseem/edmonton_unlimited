import type { SessionCreateParamsBase } from "openai/resources/beta/agents/sessions/sessions";
import { FORM_FIELD_KEYS } from "../../shared/form-fields.ts";

export const agentConfig = {
        model: "gpt-6.1-terra",
        reasoning: { effort: "medium" },

        instructions: `
        You help locate information in building-code documents.

        Use the search_code tool to find relevant pages before answering.
        Try a few concise search terms if the first search returns no results.

        Search results contain short snippets of extracted PDF text, which may have formatting
        errors or omit diagrams. Treat them as candidate source material.

        For each finding, provide the document title and physical PDF page number.
        Distinguish appendix notes from the code provisions they discuss.
        Do not invent article numbers, statements, or missing details.
        If the search results are insufficient, say what is missing.
        Do not claim to approve a design or establish code compliance.

        Use view_document_page to inspect the original page when a question
        depends on a diagram, table, or exact visual detail. Cite the document
        and physical PDF page number. Do not guess unreadable details.

        When the user asks about an uploaded project document, use
        list_application_documents to find it, then view_application_page
        to inspect relevant pages. Do not assume you have read pages you
        have not inspected.

        When a user provides information for a variance application, you may
        use suggest_form_value to propose a value for a supported field.

        Only suggest information the user explicitly provided or that is
        visible in an inspected application document. Identify the source.
        Do not guess missing applicant details.

        Suggestions require user review and do not automatically update the
        confirmed application form.
        `.trim(),

        tools: [
          {
            type: "function",
            name: "search_code",
            description:
              "Search indexed PDF pages for code topics, article numbers, or figure numbers.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description:
                    "A short search phrase, article number, or figure number.",
                },
              },
              required: ["query"],
              additionalProperties: false,
            },
          },
          {
            type: "function",
            name: "view_document_page",
            description:
              "View an original PDF page, including diagrams and tables. " +
              "Use the document ID and physical PDF page number from search results.",
            parameters: {
              type: "object",
              properties: {
                document_id: {
                  type: "integer",
                  description: "The document ID returned by search_code.",
                },
                page_number: {
                  type: "integer",
                  description: "The physical PDF page number returned by search_code.",
                },
              },
              required: ["document_id", "page_number"],
              additionalProperties: false,
            },
          },
          {
            type: "function",
            name: "list_application_documents",
            description:
              "List PDF documents uploaded to the current application.",
            parameters: {
              type: "object",
              properties: {},
              required: [],
              additionalProperties: false,
            },
          },
          {
            type: "function",
            name: "view_application_page",
            description:
              "View a page of a PDF uploaded to the current application. " +
              "Use the document ID returned by list_application_documents.",
            parameters: {
              type: "object",
              properties: {
                document_id: {
                  type: "integer",
                  description: "The uploaded document ID.",
                },
                page_number: {
                  type: "integer",
                  description: "The physical PDF page number, starting at 1.",
                },
              },
              required: ["document_id", "page_number"],
              additionalProperties: false,
            },
          },
          {
            type: "function",
            name: "suggest_form_value",
            description:
              "Suggest a value for an application form field. " +
              "The suggestion is saved for the user to review; it does not " +
              "change the confirmed form.",
            parameters: {
              type: "object",
              properties: {
                field_key: {
                  type: "string",
                  enum: FORM_FIELD_KEYS,
                },
                value: {
                  type: "string",
                  description: "The proposed field value.",
                },
                explanation: {
                  type: "string",
                  description:
                    "Why this value is suggested, including the document and " +
                    "page or the user's message when available.",
                },
              },
              required: ["field_key", "value", "explanation"],
              additionalProperties: false,
            },
          },
        ],
      } satisfies SessionCreateParamsBase["agent"];
