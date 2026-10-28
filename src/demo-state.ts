// Only navigation IDs live in browser storage. Application content remains in
// PostgreSQL, and login tokens remain in HttpOnly cookies.
export function readDemoSelection(key: string): string {
  try { return localStorage.getItem(`variance-demo:${key}`) ?? ""; }
  catch { return ""; }
}
export function saveDemoSelection(key: string, id: string) {
  try {
    if (id) localStorage.setItem(`variance-demo:${key}`,id);
    else localStorage.removeItem(`variance-demo:${key}`);
  } catch { /* Browser storage restrictions do not prevent server-side access. */ }
}
