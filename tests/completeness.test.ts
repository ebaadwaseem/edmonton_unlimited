import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompletenessFindings } from "../backend/completeness.ts";
import type { SubmissionSnapshot } from "../shared/review.ts";
function snapshot(form: Record<string, any> = {}): SubmissionSnapshot {
  return { application: { id: "fixture", title: "Fictional test", jurisdiction: "Alberta", form_data: form }, documents: [], suggestions: [], attributionChecks: [], references: [] };
}
test("missing core information is flagged without making optional fields compulsory", () => {
  const findings = buildCompletenessFindings(snapshot());
  assert.equal(findings.find((f) => f.key === "A.owner")?.status,"missing");
  assert.equal(findings.find((f) => f.key === "B.address")?.status,"missing");
  assert.equal(findings.find((f) => f.key === "B.permit")?.status,"not_applicable");
  assert.equal(findings.find((f) => f.key === "A.representative")?.status,"not_applicable");
  assert.equal(findings.find((f) => f.key === "D.scope")?.status,"needs_clarification");
  assert.ok(!findings.some((f) => /signature/i.test(f.title)));
});
test("jurisdiction-wide location and the SCC checkbox remain separate", () => {
  const site = buildCompletenessFindings(snapshot({ project: { sccSubmitted: true } }));
  assert.equal(site.find((f) => f.key === "B.address")?.status,"missing");
  const wide = buildCompletenessFindings(snapshot({ project: { jurisdictionWide: true,sccSubmitted: false } }));
  assert.equal(wide.find((f) => f.key === "B.address")?.status,"not_applicable");
});
test("manual code values and an unverified compatibility check never become source verification", () => {
  const data = snapshot({ sectionC: { code: "NBC 2023 Alberta",article1: "3.8.3.20.(1)",objective1: "OA2",function1: "F74",intent1: "Applicant text" } });
  data.attributionChecks = [{ row: 1,verified: false,blockers: ["National intent compatibility is unverified."] }];
  const finding = buildCompletenessFindings(data).find((f) => f.key === "C.1.verification")!;
  assert.equal(finding.status,"unverified"); assert.match(finding.detail,/compatibility is unverified/);
});
test("recommended documents and professional roles are distinct from uploads and named parties", () => {
  const data = snapshot({ sectionD: { document1: "Fictional accessibility report" },sectionDEvidence: { 1: { status: "recommended",professionalRole: "Professional engineer",engineeringAssessment: "not_assessed" } } });
  let findings = buildCompletenessFindings(data);
  assert.equal(findings.find((f) => f.key === "D.1.document")?.status,"needs_clarification");
  assert.match(findings.find((f) => f.key === "D.1.document")!.detail,/Recommended only/);
  assert.match(findings.find((f) => f.key === "D.1.responsible")!.detail,/Recommended role only/);
  data.documents = [{ id: "upload",original_filename: "Fictional accessibility report",page_count: 1,uploaded_at: "2026-10-28",sha256: "fixture" }];
  findings = buildCompletenessFindings(data);
  assert.equal(findings.find((f) => f.key === "D.1.document")?.status,"provided");
  assert.match(findings.find((f) => f.key === "D.1.document")!.detail,/matching file name is not enough for completeness/);
  assert.equal(findings.find((f) => f.key === "D.1.responsible")?.status,"needs_clarification");
  data.application.form_data.sectionD.responsible1 = "Fictional named applicant contact";
  assert.match(buildCompletenessFindings(data).find((f) => f.key === "D.1.responsible")!.detail,/licence and engagement are not verified/);
});
test("pending suggestions remain unaccepted findings instead of changing supplied facts", () => {
  const data = snapshot(); data.suggestions = [{ id: "fixture",field_key: "applicant.ownerName",suggested_value: "Fictional person",status: "pending",explanation: "Fixture",metadata: {} }];
  const findings = buildCompletenessFindings(data);
  assert.equal(findings.find((f) => f.key === "A.owner")?.status,"missing");
  assert.equal(findings.find((f) => f.key === "suggestions.pending")?.status,"unverified");
});
