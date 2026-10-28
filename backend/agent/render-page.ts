import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export async function renderPdfPage(pdf: Buffer, page: number, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const dir = await mkdtemp(join(tmpdir(), "variance-page-"));
  try {
    const path = join(dir, "in.pdf");
    const prefix = join(dir, "page");
    await writeFile(path, pdf, { signal });
    for (const [scale, quality] of [[1800, 80], [1400, 70], [1000, 60]]) {
      await execFileAsync("pdftoppm", [
        "-f", String(page), "-l", String(page), "-singlefile", "-jpeg",
        "-jpegopt", `quality=${quality}`, "-scale-to", String(scale), path, prefix,
      ], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 });
      const url = `data:image/jpeg;base64,${(await readFile(`${prefix}.jpg`)).toString("base64")}`;
      if (url.length <= 1_048_576) return url;
    }
    throw new Error("This PDF page exceeds the image limit even at reduced quality.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
