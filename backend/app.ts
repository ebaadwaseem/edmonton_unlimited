import express from "express";
import multer from "multer";
import { router as applications } from "./routes/applications.ts";
import { router as documents } from "./routes/documents.ts";
import { router as suggestions } from "./routes/suggestions.ts";
import { router as messages } from "./routes/messages.ts";
import { router as preview } from "./routes/preview.ts";
import { router as attributions } from "./routes/attributions.ts";
import { router as reviews } from "./routes/reviews.ts";
import { createDemoAccess } from "./demo-access.ts";
import type { DemoAccessConfig } from "./demo-access.ts";

export function createApp(options: { access?: DemoAccessConfig } = {}) {
  if (process.env.NODE_ENV === "production") throw new Error("The local demo access mechanism is not suitable for production. Configure production identity and authorization before deployment.");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", (_request, response) => { response.json({ status: "ok" }); });
  const access = createDemoAccess(options.access);
  app.use(access.authenticate, access.router);
  app.use((request, response, next) => request.path.toLowerCase().startsWith("/api/") ? access.authorize(request, response, next) : next());
  app.use(applications, documents, suggestions, messages, preview, attributions, reviews);
  app.use("/api", (_request, response) => { response.status(404).json({ error: "API route not found." }); });
  // Keep error handling after every route so Express 5 async errors reach it.
  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (response.headersSent) { next(error); return; }
    if (error instanceof multer.MulterError) {
      response.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "The PDF must be 25 MB or smaller." : error.message });
      return;
    }
    const status = error && typeof error === "object" && "status" in error ? error.status : null;
    if (status === 400 || status === 413) {
      response.status(status).json({ error: status === 413 ? "Request body is too large." : "Invalid JSON request body." });
      return;
    }
    console.error("Request failed:", error instanceof Error ? error.message : "Unknown error");
    response.status(500).json({ error: "The request failed." });
  });
  return app;
}
