import "dotenv/config";

import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";

import { execFileSync } from "node:child_process";
import { Client } from "pg";

const PDF_ROOT = "database/pdf";

// Find PDF files inside the folder and its subfolders.
async function findPdfs(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findPdfs(fullPath)));
    } else if (
      entry.isFile() &&
      extname(entry.name).toLowerCase() === ".pdf"
    ) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

// Assign a document type based on the folder.
function getDocumentType(filePath: string): string {
  const parts = relative(PDF_ROOT, filePath)
    .split(/[\\/]/)
    .map((part) => part.toLowerCase());

  if (parts.includes("templates")) {
    return "template";
  }

  if (parts.includes("alberta_legislation_building_codes")) {
    return "legislation";
  }

  if (parts.includes("national_building_codes")) {
    return "building_code";
  }

  if (parts.includes("user_guides_and_illustrations")) {
    return "guide";
  }

  return "other";
}

async function main() {
  const { DB_NAME, DB_USER, DB_PASSWORD } = process.env;

  if (!DB_NAME || !DB_USER || !DB_PASSWORD) {
    throw new Error(
      "DB_NAME, DB_USER, and DB_PASSWORD must be set in your .env file."
    );
  }

  const pdfFiles = await findPdfs(PDF_ROOT);

  if (pdfFiles.length === 0) {
    console.log(`No PDFs found inside ${PDF_ROOT}.`);
    return;
  }

  const client = new Client({
    host: "127.0.0.1",
    port: 5432,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  });

  await client.connect();

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (const filePath of pdfFiles) {
      try {
        const fileBytes = await readFile(filePath);
        const filename = basename(filePath);

        // Read the PDF to obtain its page count.
        let pageCount: number | null = null;

        try {
          const info = execFileSync("pdfinfo", [filePath], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });

          const match = info.match(/^Pages:\s+(\d+)/m);

          if (match) {
            pageCount = Number(match[1]);
          } else {
            console.warn(`Could not find page count: ${filePath}`);
          }
        } catch {
          console.warn(`Could not read PDF metadata: ${filePath}`);
        }

        // Skip an exact file that is already in the database.
        // This compares the original bytes, not just the filename.
        const existing = await client.query(
          `
          SELECT id
          FROM documents
          WHERE file_bytes = $1
          LIMIT 1
          `,
          [fileBytes]
        );

        if (existing.rowCount && existing.rowCount > 0) {
          console.log(`SKIPPED: ${filePath} — already imported`);
          skipped++;
          continue;
        }

        // Use the filename as the initial title.
        // We can improve titles and add edition/jurisdiction later.
        const title = basename(filename, extname(filename));
        const documentType = getDocumentType(filePath);

        const result = await client.query(
          `
          INSERT INTO documents (
            title,
            document_type,
            original_filename,
            file_bytes,
            page_count,
            processing_status
          )
          VALUES ($1, $2, $3, $4, $5, 'uploaded')
          RETURNING id
          `,
          [
            title,
            documentType,
            filename,
            fileBytes,
            pageCount,
          ]
        );

        console.log(
          `IMPORTED: ${filePath} | ID ${result.rows[0].id} | ` +
          `${documentType} | ${pageCount} pages`
        );

        imported++;
      } catch (error: unknown) {
        failed++;

        console.error(
          `FAILED: ${filePath} | ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  } finally {
    await client.end();
  }

  console.log("\nFinished:");
  console.log(`  Imported: ${imported}`);
  console.log(`  Already present: ${skipped}`);
  console.log(`  Failed: ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(
    "Import failed:",
    error instanceof Error ? error.message : String(error)
  );
  process.exitCode = 1;
});
