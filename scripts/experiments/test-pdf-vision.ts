import "dotenv/config";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { PDFDocument } from "pdf-lib";
import OpenAI from "openai";

async function main() {
  const pdfPath = process.argv[2];
  const pageArguments = process.argv.slice(3);

  if (!pdfPath || pageArguments.length === 0) {
    console.error(
      'Usage: npx tsx scripts/experiments/test-pdf-vision.ts "path/to/file.pdf" 10 11'
    );
    console.error(
      "Page numbers are the physical PDF pages shown by your PDF viewer."
    );
    process.exitCode = 1;
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY was not found in your .env file.");
  }

  const pages = pageArguments.map(Number);

  if (
    pages.some(
      (page) => !Number.isInteger(page) || page < 1
    )
  ) {
    throw new Error("Every page number must be a positive whole number.");
  }

  // Keep the first experiment small and predictable.
  if (pages.length > 5) {
    throw new Error("Choose no more than 5 pages for this test.");
  }

  if (new Set(pages).size !== pages.length) {
    throw new Error("Please list each page number only once.");
  }

  const originalBytes = await readFile(pdfPath);
  const originalPdf = await PDFDocument.load(originalBytes);
  const totalPages = originalPdf.getPageCount();

  if (pages.some((page) => page > totalPages)) {
    throw new Error(`This PDF has ${totalPages} pages.`);
  }

  // Make a temporary PDF in memory containing only the selected pages.
  const selectedPdf = await PDFDocument.create();

  const copiedPages = await selectedPdf.copyPages(
    originalPdf,
    pages.map((page) => page - 1)
  );

  for (const page of copiedPages) {
    selectedPdf.addPage(page);
  }

  const selectedBytes = await selectedPdf.save();
  const base64Pdf = Buffer.from(selectedBytes).toString("base64");

  const client = new OpenAI();

  console.log(`Document: ${basename(pdfPath)}`);
  console.log(`Original PDF pages selected: ${pages.join(", ")}`);
  console.log("Sending selected pages to gpt-6.1-terra...\n");

  const response = await client.responses.create({
    model: "gpt-6.1-terra",
    reasoning:{"effort": "medium"},
    store: false,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "selected-pages.pdf",
            file_data: `data:application/pdf;base64,${base64Pdf}`,
            detail: "high",
          },
          {
            type: "input_text",
            text: `
          You are extracting content from selected pages of a building-code PDF.

          The pages in the provided PDF correspond, in order, to these physical
          page numbers in the original PDF: ${pages.join(", ")}.

          Your task is faithful extraction for a document-search test.
          Do not summarize, paraphrase, interpret, or make compliance decisions.

          For each page, provide the following:

          ## 1. Page identification

          - Original physical PDF page number.
          - Printed page number, if visible.
          - Division, section heading, and article numbers, if visible.
          - If the page begins or ends in the middle of an article, say so.
          - If an article heading is not visible, do not guess it from a running
            header or from the surrounding text.

          ## 2. Text transcription

          Transcribe the complete visible body text in reading order.

          - Preserve headings, article numbers, sentence numbers, clause letters,
            punctuation, units, measurements, references, and exceptions.
          - Preserve words such as "shall", "must", "should", "may", and "permitted"
            exactly as written.
          - Do not replace sentences with summaries or ellipses.
          - Mark any text you cannot read as [unclear] rather than guessing.
          - Do not complete a cut-off sentence using outside knowledge.
          - Exclude repetitive copyright notices and decorative page headers,
            unless a header is needed to identify the page.

          ## 3. Tables

          For every visible table:

          - Transcribe its title, column headings, rows, values, symbols, and notes.
          - Preserve the relationship between each value and its row and column.
          - Include footnote numbers and the visible text of each footnote.
          - If a table continues onto another page or a value is unclear, say so.
          - Do not simplify load combinations, coefficients, or measurements.

          ## 4. Diagrams and figures

          For every visible diagram or figure:

          - Give its exact figure number and caption, if visible.
          - Transcribe its visible labels, dimensions, symbols, and annotations.
          - Describe the arrangement of the components and their connections.
          - Clearly separate the visible labels from your own description.
          - State when a label or detail is unclear.
          - Do not infer measurements or details that are not visible.

          ## 5. References and missing context

          List references to articles, tables, figures, standards, or notes that
          are mentioned but not included in the provided pages.

          Flag anything that requires a preceding or following page to understand
          the context. Do not treat an appendix note as the article it refers to.

          Use a separate section for each original PDF page. Do not make up content.
          `.trim(),
          },
        ],
      },
    ],
  });

  console.log(response.output_text);

  if (response.usage) {
    console.log("\n--- Token usage ---");
    console.log(`Input tokens: ${response.usage.input_tokens}`);
    console.log(`Output tokens: ${response.usage.output_tokens}`);
  }
}

main().catch((error: unknown) => {
  console.error(
    "Test failed:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
