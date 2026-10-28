// Keep below the 1 MiB durable-result limit reported by the deployed API.
// Reserve space for JSON framing, metadata, and UTF-8 text, not just the image URL.
export const MAX_TOOL_RESULT_BYTES = 900 * 1024;
export const MAX_PAGE_IMAGE_URL_BYTES = 700 * 1024;

export function fitsToolResult(value: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_TOOL_RESULT_BYTES;
}
