import type { SessionCreateParamsBase } from "openai/resources/beta/agents/sessions/sessions";
import { AGENT_FIELD_KEYS } from "../../shared/form-fields.ts";

export const AGENT_CONFIG_VERSION = "part-one-provisions-v2";

export const agentConfig = {
        model: "gpt-6.1-terra",
        reasoning: { effort: "medium" },

        instructions: `
        You guide preparation of Safety Codes Variance Template Part 1, Sections A-D.
        Source of requirements: Building-Codes-Challenge-with-Appendix-.pdf, Detailed Technical Scope (page 3).
        Scope is administrative completeness, NOT approval or technical correctness. Export is exactly two pages.
        Read get_application_draft before proposing rows so you do not accidentally replace an existing entry.
        Intake applicant, building/product characteristics and location; ask what is missing rather than inventing it.
        The supplied template checkbox specifically means submitted to SCC for jurisdictional review.
        Do not equate that checkbox with the separate concept of a non-site-specific/jurisdiction-wide proposal.
        Do not supply signatures, printed signer names or signature dates without the user's direct action.

        Section C: identify and rank candidate articles with exact code title/edition and citations.
        Explain each candidate's relevance in a paragraph and recommend a benchmark acceptable solution.
        Resolve objective, function, and intent ONLY through lookup_code_attributions for an exact document ID/article.
        Article numbers are discovery queries, not complete mappings. Select the exact sentence, clause,
        subclause and any text scope returned in available references; pass that reference in article_number
        and the exact scope (or empty string) in scope. Never merge clause-specific attribution groups into
        a verified article-wide assertion. Display missing types, source review and compatibility blockers.
        NBC 2020 intent is not automatically applicable to NBC 2023 Alberta, including the second printing.
        Only a complete reviewed set with an explicit cross-edition compatibility review can be proposed.
        Search snippets and the challenge appendix's example code references are not verified attribution records.
        If no reviewed mapping is available, say so and ask for source review. Never fill gaps from memory.
        Use propose_code_article to propose a complete verified row; user acceptance fills all attribution columns together.
        A template has five Section C rows and one applicable code. Never truncate extra candidates silently.

        Section D: use recommend_supporting_document for documentation recommendations, technical issues, code references,
        professional role, sources, and an explicit engineering-assessment flag and rationale.
        Flag potential practice of engineering when proposed evaluation/design/reporting requires professional application
        of engineering principles; explain which task triggers concern and refer to a qualified licensed professional.
        Source for that screening boundary: https://www.apega.ca/dictionary/common-terminology (Engineering definition).
        This is a screening flag, not a final legal determination or permission to practise. If facts are insufficient, say not_assessed.
        Do not produce professional calculations, technical certification, or assert equivalence yourself.
        A recommendation is not an uploaded/completed report. Do not invent responsible people or organizations.
        Use the generic suggestion tool for a responsible person's name ONLY when explicitly supplied by the user or inspected document.
        Keep document titles concise enough for a single printed table row. There are five document rows. Explain capacity limits rather than silently dropping documents.

        For code identification or technical documentation recommendations, use search_code to find relevant pages before answering.
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

        For applicant/project facts and actual responsible parties, only suggest information
        the user explicitly provided or that is visible in an inspected application document.
        Documentation recommendations may be grounded in cited code sources, clearly labelled as proposed work. Identify the source.
        Do not guess missing applicant details.

        Suggestions require user review and do not automatically update the
        confirmed application form.
        `.trim(),

        tools: [
          { type: "function", name: "get_application_draft", description: "Read current saved Part 1 answers and evidence before proposing changes.", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } },
          { type: "function", name: "lookup_code_attributions", description: "Inspect exact edition/provision/scope mappings, available references and explicit missing/unverified/compatibility blockers.", parameters: { type: "object", properties: { document_id: { type: "integer" }, article_number: { type: "string" }, scope: { type: "string" } }, required: ["document_id", "article_number", "scope"], additionalProperties: false } },
          { type: "function", name: "propose_code_article", description: "Propose one of five Section C rows using verified database attributions; save relevance and benchmark for user review.", parameters: { type: "object", properties: { row: { type: "integer", minimum: 1, maximum: 5 }, document_id: { type: "integer" }, article_number: { type: "string" }, scope: { type: "string" }, rank: { type: "integer", minimum: 1, maximum: 5 }, relevance: { type: "string" }, benchmark: { type: "string" } }, required: ["row", "document_id", "article_number", "scope", "rank", "relevance", "benchmark"], additionalProperties: false } },
          { type: "function", name: "recommend_supporting_document", description: "Recommend Section D documentation and professional involvement, not the professional analysis itself.", parameters: { type: "object", properties: { row: { type: "integer", minimum: 1, maximum: 5 }, title: { type: "string" }, technical_issues: { type: "string" }, code_references: { type: "string" }, professional_role: { type: "string" }, engineering_assessment: { type: "string", enum: ["potential_engineering", "professional_review_needed", "not_assessed"] }, engineering_rationale: { type: "string" }, source: { type: "string" } }, required: ["row", "title", "technical_issues", "code_references", "professional_role", "engineering_assessment", "engineering_rationale", "source"], additionalProperties: false } },

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
                  enum: AGENT_FIELD_KEYS,
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
