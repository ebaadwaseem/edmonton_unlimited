export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 401 && !path.startsWith("/api/auth")) window.dispatchEvent(new Event("demo-session-expired"));
    throw new Error(body?.error ?? `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}
export function post<T>(path: string, body: unknown) {
  return api<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
