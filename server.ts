import { createApp } from "./backend/app.ts";
import { db } from "./backend/db.ts";

// Local development only: the API isn't exposed to the network.
const server = createApp().listen(3001, "127.0.0.1", () => {
  console.log("Backend running at http://127.0.0.1:3001");
});
server.on("error", () => { console.error("Backend could not listen on port 3001."); process.exitCode = 1; });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    const deadline = setTimeout(() => process.exit(1), 15_000).unref();
    server.close(() => { void db.end().finally(() => clearTimeout(deadline)); });
  });
}
