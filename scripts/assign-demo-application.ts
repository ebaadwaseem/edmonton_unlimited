import { db } from "../backend/db.ts";
import { parseId } from "../backend/http.ts";
try {
  const id = parseId(process.argv[2] ?? "");
  if (id === null) throw new Error("Usage: npm run demo:assign -- <legacy-application-id>. Assign only a draft you are authorized to use in the shared local demo.");
  const result = await db.query("UPDATE applications SET owner_id='demo-applicant' WHERE id=$1 AND owner_id IS NULL RETURNING id",[id]);
  if (!result.rows.length) throw new Error("Application not found or already assigned; no ownership was changed.");
  console.log(`Assigned legacy application ${id} to the shared local demo applicant. Form data, uploads, conversation and suggestions were not changed.`);
} catch (error) { console.error(error instanceof Error ? error.message : "Assignment failed."); process.exitCode=1; }
finally { await db.end(); }
