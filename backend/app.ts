import express from "express";
import multer from "multer";
import { router as applications } from "./routes/applications.ts";
import { router as documents } from "./routes/documents.ts";
import { router as suggestions } from "./routes/suggestions.ts";
import { router as messages } from "./routes/messages.ts";
import { router as preview } from "./routes/preview.ts";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", (_request, response) => { response.json({ status: "ok" }); });
  app.use(applications, documents, suggestions, messages, preview);
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
