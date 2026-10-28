import "dotenv/config";

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

async function main() {
  const documentId = Number(process.argv[2]);

  if (!Number.isInteger(documentId) || documentId < 1) {
    console.error(
      "Usage: npx tsx scripts/index-document.ts <document-id>"
    );
    process.exitCode = 1;
    return;
  }

  const { DB_NAME, DB_USER, DB_PASSWORD } = process.env;

  if (!DB_NAME || !DB_USER || !DB_PASSWORD) {
    throw new Error(
      "DB_NAME, DB_USER, and DB_PASSWORD must be set in .env."
    );
  }

  const client = new Client({
    host: "127.0.0.1",
    port: 5432,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  });

  await client.connect();

  let tempDirectory: string | undefined;

  try {
    const result = await client.query(
      `
      SELECT id, title, file_bytes, page_count
      FROM documents
      WHERE id = $1
      `,
      [documentId]
    );

    if (result.rows.length === 0) {
      throw new Error(`No document exists with ID ${documentId}.`);
    }

    const document = result.rows[0];

    if (!document.page_count) {
      throw new Error(
        "This document has no page count. Check it with pdfinfo first."
      );
    }

    // pdftotext needs a file path, so temporarily write the
    // original PDF from PostgreSQL to your Mac.
    tempDirectory = await mkdtemp(join(tmpdir(), "safety-codes-"));
    const tempPdfPath = join(tempDirectory, "document.pdf");

    await writeFile(tempPdfPath, document.file_bytes);

    console.log(`Indexing: ${document.title}`);
    console.log(`Document ID: ${document.id}`);
    console.log(`Pages: ${document.page_count}\n`);

    const { stdout } = await execFileAsync("pdftotext", ["-layout", tempPdfPath, "-"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 180_000,
    });
    const pages = stdout.replaceAll("\0", "").split("\f");
    // Poppler ends the last page with a form feed. Remove only that separator;
    // internal empty strings represent real blank pages and must keep their numbers.
    if (pages.at(-1) === "") pages.pop();
    if (pages.length !== document.page_count)
      throw new Error(`Expected ${document.page_count} pages; extracted ${pages.length}. Existing index was preserved.`);
    const texts = pages.map((page) => page.trim());
    const numbers = pages.map((_, index) => index + 1);
    const statuses = texts.map((page) => page ? "extracted" : "needs_review");
    const extracted = texts.filter(Boolean).length;
    const needsReview = texts.length - extracted;
    await client.query("BEGIN");
    try {
      await client.query(`
        INSERT INTO document_pages (document_id, pdf_page_number, extracted_text, extraction_status)
        SELECT $1, page_number, NULLIF(page_text, ''), page_status
        FROM unnest($2::int[], $3::text[], $4::text[]) AS pages(page_number, page_text, page_status)
        ON CONFLICT (document_id, pdf_page_number) DO UPDATE SET
          extracted_text = EXCLUDED.extracted_text,
          extraction_status = EXCLUDED.extraction_status
      `, [documentId, numbers, texts, statuses]);
      await client.query("UPDATE documents SET processing_status = 'needs_review' WHERE id = $1", [documentId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }

    console.log("\nFinished:");
    console.log(`  Pages with extracted text: ${extracted}`);
    console.log(`  Blank or failed pages: ${needsReview}`);
    console.log(
      "The original PDF remains stored in the documents table."
    );
  } finally {
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true });
    }

    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Indexing failed:",
    error instanceof Error ? error.message : String(error)
  );
  process.exitCode = 1;
});
