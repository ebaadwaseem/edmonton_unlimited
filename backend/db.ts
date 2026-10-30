import "dotenv/config";
import { Pool } from "pg";

// grab info from .env file
const { DB_NAME, DB_USER, DB_PASSWORD } = process.env;
if (!DB_NAME || !DB_USER || !DB_PASSWORD) {
  throw new Error("DB_NAME, DB_USER, and DB_PASSWORD must be set in .env.");
}

export const db = new Pool({
  host: "127.0.0.1", port: 5432,
  database: DB_NAME, user: DB_USER, password: DB_PASSWORD,
  connectionTimeoutMillis: 5000,
});
db.on("error", () => console.error("An idle database connection failed."));
