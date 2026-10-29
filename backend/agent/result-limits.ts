// The API's 1 MiB durable-result limit is not a wire-JSON limit: production
// rejected a 576,831-byte image result while accepting 455,155 bytes. Leave
// headroom for its internal representation (whose exact size is not exposed).
export const MAX_TOOL_RESULT_BYTES = 450 * 1024;
export const MAX_PAGE_IMAGE_URL_BYTES = 400 * 1024;

export function fitsToolResult(value: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_TOOL_RESULT_BYTES;
}
