import { useEffect, useState } from "react";
import VarianceWorkspace from "./VarianceWorkspace";
import ReviewerWorkspace from "./ReviewerWorkspace";
import { api, post } from "./api";
import "./ReviewWorkspace.css";
type Principal = { id: string; role: "applicant" | "reviewer" };
export default function App() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("applicant");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void api<{ principal: Principal | null }>("/api/auth/session").then((session) => setPrincipal(session.principal)).catch((error) => setError(error.message)).finally(() => setLoading(false));
    const expired = () => { setPrincipal(null); setError("Your demo session ended. Sign in again; saved drafts and submissions remain in the database."); };
    window.addEventListener("demo-session-expired", expired);
    return () => window.removeEventListener("demo-session-expired", expired);
  }, []);
  async function login(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try { const result = await post<{ principal: Principal }>("/api/auth/login", { role, passcode }); setPrincipal(result.principal); setPasscode(""); }
    catch (error) { setError(error instanceof Error ? error.message : "Sign in failed."); }
    finally { setLoading(false); }
  }
  async function logout() {
    try { await post("/api/auth/logout", {}); setPrincipal(null); }
    catch (error) { setError(error instanceof Error ? error.message : "Sign out failed."); }
  }
  if (!principal) return <main className="demo-login">
    <div><span className="review-eyebrow">Building Codes Challenge</span>
      <form onSubmit={(event) => void login(event)}>
        <label htmlFor="demo-role">View</label><select id="demo-role" value={role} onChange={(event) => setRole(event.target.value)}><option value="applicant">Applicant</option><option value="reviewer">Safety Codes Officer / Reviewer</option></select>
        <label htmlFor="demo-passcode">Demo role passcode</label><input id="demo-passcode" type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} autoComplete="current-password" required />
        <p>Applicant password: 1234</p>
        <p>Reviewer password: 5678</p>
        {error && <p role="alert" className="review-error">{error}</p>}<button type="submit" disabled={loading || !passcode}>{loading ? "Connecting…" : "Enter demo"}</button>
      </form>
    </div>
  </main>;
  return <div className="demo-shell">
    <header className="demo-topbar"><div><strong>Building Codes Challenge</strong><span>{principal.role === "reviewer" ? "Safety Codes Officer / reviewer" : "Applicant workspace"} · Local demo</span></div><button type="button" onClick={() => void logout()}>Sign out / change role</button></header>
    {error && <p className="review-error" role="alert">{error}</p>}
    {principal.role === "reviewer" ? <ReviewerWorkspace key={principal.id} /> : <VarianceWorkspace key={principal.id} />}
  </div>;
}
