import assert from "node:assert/strict";
import { test } from "node:test";
import { fitsToolResult, MAX_PAGE_IMAGE_URL_BYTES, MAX_TOOL_RESULT_BYTES } from "../backend/agent/result-limits.ts";
import { renderPdfPage } from "../backend/agent/render-page.ts";
import { loadTemplateBytes } from "../backend/template.ts";

test("image results reserve space for JSON metadata and multilingual source labels", () => {
  const url = `data:image/jpeg;base64,${"a".repeat(MAX_PAGE_IMAGE_URL_BYTES - 23)}`;
  const output = { type: "agent.session.input.tool_result", turn_id: "turn-1", call_id: "call-1", success: true,
    output: [{ type: "input_text", text: `Original PDF: ${"é📄".repeat(2000)}, page 1.` }, { type: "input_image", image_url: url }] };
  assert.ok(fitsToolResult(output));
  assert.ok(Buffer.byteLength(JSON.stringify(output), "utf8") <= MAX_TOOL_RESULT_BYTES);
  assert.ok(MAX_TOOL_RESULT_BYTES < 1_048_576);
});

test("rendered template pages fit the smaller image budget and remain JPEGs", async () => {
  const url = await renderPdfPage(Buffer.from(await loadTemplateBytes()), 1);
  assert.ok(Buffer.byteLength(url, "utf8") <= MAX_PAGE_IMAGE_URL_BYTES);
  assert.ok(url.startsWith("data:image/jpeg;base64,"));
  const bytes = Buffer.from(url.split(",")[1], "base64");
  assert.equal(bytes.subarray(0, 2).toString("hex"), "ffd8");
});
