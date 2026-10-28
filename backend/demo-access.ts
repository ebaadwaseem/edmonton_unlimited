import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { RequestHandler } from "express";
import { db } from "./db.ts";
import { parseId } from "./http.ts";
export type DemoRole = "applicant" | "reviewer";
export type DemoAccessConfig = { applicantPasscode: string; reviewerPasscode: string; allowedOrigins?: string[] };
export type Principal = { id: string; role: DemoRole };
const digest = (value: string) => createHash("sha256").update(value).digest();
const cookieName = "variance_demo_session";
// Browsers cap persistent cookies at roughly 400 days; renew on authenticated
// requests. The durable server session has no eight-hour expiration.
const cookieMaxAge = 400 * 24 * 60 * 60;
export function createDemoAccess(config?: DemoAccessConfig) {
  if (config && (!config.applicantPasscode.trim() || !config.reviewerPasscode.trim() || config.applicantPasscode === config.reviewerPasscode)) throw new Error("Use distinct, nonempty demo role passcodes.");
  const credentialFingerprint = (role: DemoRole) => digest(`${role}:${role === "applicant" ? config!.applicantPasscode : config!.reviewerPasscode}`).toString("hex");
  const attempts = new Map<string, { count: number; until: number }>();
  const router = Router();
  const origins = new Set(config?.allowedOrigins ?? ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3001", "http://127.0.0.1:3001"]);
  const cookie = (token: string, maxAge: number) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
  const authenticate: RequestHandler = async (request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && (request.get("Sec-Fetch-Site") === "cross-site" || request.get("Origin") && !origins.has(request.get("Origin")!))) {
      response.status(403).json({ error: "Cross-origin demo requests are not allowed." }); return;
    }
    const token = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (token && config) {
      const key = digest(token).toString("hex");
      const session = (await db.query("SELECT principal_id,role,credential_fingerprint FROM demo_sessions WHERE token_hash=$1",[key])).rows[0];
      if (session && ["applicant","reviewer"].includes(session.role) && session.principal_id === `demo-${session.role}` && session.credential_fingerprint === credentialFingerprint(session.role)) {
        response.locals.principal = { id: session.principal_id, role: session.role };
        response.setHeader("Set-Cookie",cookie(token,cookieMaxAge));
      }
    }
    next();
  };
  router.get("/api/auth/session", (_request, response) => response.json({ principal: response.locals.principal ?? null, mode: "local-demo", configured: Boolean(config) }));
  router.post("/api/auth/login", async (request, response) => {
    if (!config) { response.status(503).json({ error: "Demo access is not configured. Start the backend using npm run server." }); return; }
    const { role, passcode } = request.body ?? {};
    const ip = request.ip ?? "local";
    const attempt = attempts.get(ip);
    if (attempt && attempt.until > Date.now() && attempt.count >= 10) { response.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." }); return; }
    if (!["applicant", "reviewer"].includes(role) || typeof passcode !== "string" || passcode.length > 500 || !timingSafeEqual(digest(passcode), digest(role === "applicant" ? config.applicantPasscode : config.reviewerPasscode))) {
      attempts.set(ip, { count: (attempt && attempt.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 900_000 });
      response.status(401).json({ error: "Invalid demo role or passcode." }); return;
    }
    attempts.delete(ip);
    const token = randomBytes(32).toString("base64url");
    const principal: Principal = { id: `demo-${role}`, role };
    // Revoke this browser's prior role session on a role switch.
    const old = request.headers.cookie?.match(/(?:^|;\s*)variance_demo_session=([^;]+)/)?.[1];
    await db.query(`WITH revoked AS (DELETE FROM demo_sessions WHERE token_hash=$1)
      INSERT INTO demo_sessions (token_hash,principal_id,role,credential_fingerprint) VALUES ($2,$3,$4,$5)`,
      [old ? digest(old).toString("hex") : null,digest(token).toString("hex"),principal.id,role,credentialFingerprint(role)]);
    response.setHeader("Set-Cookie", cookie(token, cookieMaxAge));
    response.json({ principal });
  });
  router.post("/api/auth/logout", async (request, response) => {
    const token = request.headers.cookie?.match(/(?:^|;\s*)variance_demo_session=([^;]+)/)?.[1];
    if (token) await db.query("DELETE FROM demo_sessions WHERE token_hash=$1",[digest(token).toString("hex")]);
    response.setHeader("Set-Cookie", cookie("", 0)); response.json({ ok: true });
  });
  const authorize: RequestHandler = async (request, response, next) => {
    const path = request.path.toLowerCase();
    const principal: Principal | undefined = response.locals.principal;
    if (!principal) { response.status(401).json({ error: "Sign in to the local demo." }); return; }
    if (path.startsWith("/api/reviewer") && principal.role !== "reviewer" || path.startsWith("/api/applications") && principal.role !== "applicant") {
      response.status(403).json({ error: "This action belongs to the other demo role." }); return;
    }
    const application = /^\/api\/applications\/([^/]+)/.exec(path);
    const submission = /^\/api\/submissions\/([^/]+)/.exec(path);
    if (application || submission) {
      const id = parseId((application ?? submission)![1]);
      if (id === null) { response.status(400).json({ error: "Invalid resource ID." }); return; }
      const result = application
        ? await db.query("SELECT owner_id FROM applications WHERE id=$1", [id])
        : await db.query("SELECT a.owner_id FROM application_submissions s JOIN applications a ON a.id=s.application_id WHERE s.id=$1", [id]);
      if (!result.rows.length || principal.role === "applicant" && result.rows[0].owner_id !== principal.id) { response.status(404).json({ error: "Resource not found." }); return; }
      if (submission && !["GET","HEAD"].includes(request.method)) { response.status(405).json({ error: "Submitted artifacts are read only." }); return; }
    }
    next();
  };
  return { router, authenticate, authorize };
}
