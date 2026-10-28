import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { importCandidates, recordAttributionReview, validateCandidateDataset } from "../backend/attribution-import.ts";
const dataset = JSON.parse(await readFile(new URL("../database/reference_candidates/accessibility-2023-ab.json", import.meta.url), "utf8"));

test("the source-extracted accessibility dataset contains five precise references and no reviewed claims", () => {
  validateCandidateDataset(dataset);
  assert.equal(dataset.provisions.length, 5);
  assert.equal(dataset.provisions.flatMap((p: any) => p.attributions).length, 15);
  assert.ok(dataset.provisions.every((p: any) => p.reference.includes(".(")));
  assert.ok(dataset.provisions.every((p: any) => p.attributions.every((a: any) => !a.verification_status && !a.compatibility_status)));
});
test("candidate import rejects legacy article-only verified data and self-verification", () => {
  assert.throws(() => validateCandidateDataset({ reviewed_by: "Someone", articles: [{}] }), /legacy/);
  for (const [field, value] of [["verification_status", "verified"], ["compatibility_status", "verified"]]) {
    const data = structuredClone(dataset); data.provisions[0].attributions[0][field] = value;
    assert.throws(() => validateCandidateDataset(data), /cannot verify/);
  }
});
test("candidate import rejects changed source bytes before updating document metadata", async () => {
  const queries: string[] = [];
  const client = { query: async (sql: string) => { queries.push(sql); return { rows: [{ page_count: 1578, sha256: "wrong-source-hash" }] }; } } as unknown as PoolClient;
  await assert.rejects(importCandidates(client, dataset), /fingerprint/);
  assert.equal(queries.length, 1);
});
test("candidate import never writes verified review or compatibility statuses", async () => {
  const data = structuredClone(dataset); data.provisions = [data.provisions[0]];
  const writes: string[] = [];
  const client = { query: async (sql: string, params: unknown[]) => {
    if (sql.startsWith("SELECT page_count")) return { rows: [{ page_count: 4000, sha256: data.documents.find((d: any) => d.id === params[0]).sha256 }] };
    writes.push(sql);
    if (sql.startsWith("INSERT INTO code_provisions")) return { rows: [{ id: "1", document_sha256: data.documents[0].sha256, pdf_page_start: 307, pdf_page_end: 307 }] };
    if (sql.startsWith("INSERT INTO provision_attributions")) return { rows: [{ id: "1" }] };
    return { rows: [] };
  } } as unknown as PoolClient;
  assert.equal(await importCandidates(client, data), 4);
  assert.ok(writes.every((sql) => !sql.includes("'verified'")));
});
function reviewClient() {
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const client = { query: async (sql: string, params: unknown[]) => {
    if (sql.startsWith("SELECT p.*")) return { rows: [{ id: "1", document_id: "5", document_sha256: "sha", current_sha256: "sha" }] };
    if (sql.startsWith("SELECT a.*")) return { rows: [{ id: "2", candidate_fingerprint: "candidate", current_sha256: "source", source_sha256: "source" }] };
    writes.push({ sql, params }); return { rows: [] };
  } } as unknown as PoolClient;
  return { client, writes };
}
const review = { provision_id: 1, reviewed_by: "TEST ONLY reviewer", review_basis: "TEST ONLY completeness review", expected_target_sha256: "sha", decisions: [{ id: 2, fingerprint: "candidate", status: "verified" }] };
test("recording source review alone leaves cross-edition compatibility unverified and saves an audit record", async () => {
  const { client, writes } = reviewClient();
  await recordAttributionReview(client, review);
  assert.equal(writes[0].params[3], "unverified");
  assert.equal(writes[0].params[5], null);
  assert.ok(writes.some((entry) => entry.sql.startsWith("INSERT INTO attribution_reviews")));
});
test("compatibility verification requires explicit evidence and stale candidate reviews fail", async () => {
  const { client } = reviewClient();
  await assert.rejects(recordAttributionReview(client, { ...review, decisions: [{ ...review.decisions[0], compatibility: { status: "verified" } }] }), /compatibility evidence/);
  await assert.rejects(recordAttributionReview(client, { ...review, decisions: [{ ...review.decisions[0], fingerprint: "stale" }] }), /changed/);
  await assert.rejects(recordAttributionReview(client, { ...review, decisions: [review.decisions[0], review.decisions[0]] }), /exactly once/);
});
