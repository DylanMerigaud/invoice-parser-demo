import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreInvoice, scoreAnomalies, aggregateAnomalies, type SampleScore } from "./score";
import type { Invoice } from "@/lib/schema";
import type { AnomalyCode } from "@/lib/anomalies";

/**
 * Unit tests for the eval scoring. These guard the accuracy + precision/recall
 * math the headline numbers (and the landing badge) are built on, so a scoring
 * regression can't silently inflate or deflate results.
 */

function inv(): Invoice {
  return {
    vendor: { name: "Acme Corp", address: "1 A St, Townsville", taxId: "US-1" },
    invoiceNumber: "INV-9",
    issueDate: "2024-03-01",
    dueDate: "2024-03-31",
    currency: "USD",
    lineItems: [{ description: "Thing", qty: 1, unitPrice: 10, amount: 10 }],
    subtotal: 10,
    tax: 0.8,
    total: 10.8,
  };
}

function acc(expected: Invoice, got: Invoice): number {
  return scoreInvoice(expected, got).accuracy;
}

test("identical invoices score 100%", () => {
  assert.equal(acc(inv(), inv()), 1);
});

test("vendor name matches loosely (case + whitespace)", () => {
  const got = inv();
  got.vendor.name = "  acme   corp ";
  assert.equal(acc(inv(), got), 1);
});

test("address matches across punctuation / whitespace / case differences", () => {
  const got = inv();
  // Same words, different punctuation + case + spacing → should still match.
  got.vendor.address = "1 a st,  townsville";
  const addr = scoreInvoice(inv(), got).fields.find((f) => f.field === "vendor.address");
  assert.equal(addr?.correct, true);
});

test("address scorer does NOT accept abbreviation rewrites (conservative by design)", () => {
  // "St" -> "Street" is a word-level change, not just formatting. The scorer
  // deliberately treats this as a mismatch rather than silently passing a
  // materially-different address — keeps eval numbers honest.
  const got = inv();
  got.vendor.address = "1 A Street, Townsville";
  const addr = scoreInvoice(inv(), got).fields.find((f) => f.field === "vendor.address");
  assert.equal(addr?.correct, false);
});

test("wrong invoice number is exact-matched and fails", () => {
  const got = inv();
  got.invoiceNumber = "INV-8";
  const fields = scoreInvoice(inv(), got).fields;
  assert.equal(fields.find((f) => f.field === "invoiceNumber")?.correct, false);
});

test("money within 2 cents passes; beyond fails", () => {
  const near = inv();
  near.total = 10.81; // 1 cent off
  assert.equal(scoreInvoice(inv(), near).fields.find((f) => f.field === "total")?.correct, true);

  const far = inv();
  far.total = 11.5;
  assert.equal(scoreInvoice(inv(), far).fields.find((f) => f.field === "total")?.correct, false);
});

test("optional field absent in truth is not counted (correct === null)", () => {
  const expected = inv();
  expected.vendor.taxId = null;
  expected.dueDate = null;
  const fields = scoreInvoice(expected, inv()).fields;
  assert.equal(fields.find((f) => f.field === "vendor.taxId")?.correct, null);
  assert.equal(fields.find((f) => f.field === "dueDate")?.correct, null);
});

test("line items: a wrong amount drops the match", () => {
  const got = inv();
  got.lineItems = [{ description: "Thing", qty: 1, unitPrice: 10, amount: 99 }];
  const li = scoreInvoice(inv(), got).fields.find((f) => f.field === "lineItems");
  assert.equal(li?.correct, false);
});

test("line items: extra row fails the count check", () => {
  const got = inv();
  got.lineItems = [
    { description: "Thing", qty: 1, unitPrice: 10, amount: 10 },
    { description: "Extra", qty: 1, unitPrice: 5, amount: 5 },
  ];
  const li = scoreInvoice(inv(), got).fields.find((f) => f.field === "lineItems");
  assert.equal(li?.correct, false);
});

test("scoreAnomalies computes tp/fp/fn", () => {
  const expected: AnomalyCode[] = ["totals_mismatch", "due_before_issue"];
  const got: AnomalyCode[] = ["totals_mismatch", "duplicate_line_items"];
  const r = scoreAnomalies(expected, got);
  assert.equal(r.truePositives, 1); // totals_mismatch
  assert.equal(r.falsePositives, 1); // duplicate_line_items
  assert.equal(r.falseNegatives, 1); // due_before_issue
});

test("aggregateAnomalies: empty expected & got is perfect (precision/recall = 1)", () => {
  const scores: SampleScore[] = [
    {
      id: "x",
      stresses: "",
      fields: [],
      fieldAccuracy: 1,
      anomaly: scoreAnomalies([], []),
    },
  ];
  const agg = aggregateAnomalies(scores);
  assert.equal(agg.precision, 1);
  assert.equal(agg.recall, 1);
  assert.equal(agg.f1, 1);
});

test("aggregateAnomalies: a miss drops recall, a false alarm drops precision", () => {
  const scores: SampleScore[] = [
    { id: "a", stresses: "", fields: [], fieldAccuracy: 1, anomaly: scoreAnomalies(["totals_mismatch"], []) }, // fn
    { id: "b", stresses: "", fields: [], fieldAccuracy: 1, anomaly: scoreAnomalies([], ["duplicate_line_items"]) }, // fp
    { id: "c", stresses: "", fields: [], fieldAccuracy: 1, anomaly: scoreAnomalies(["due_before_issue"], ["due_before_issue"]) }, // tp
  ];
  const agg = aggregateAnomalies(scores);
  assert.equal(agg.tp, 1);
  assert.equal(agg.fp, 1);
  assert.equal(agg.fn, 1);
  assert.equal(agg.precision, 0.5); // 1 / (1+1)
  assert.equal(agg.recall, 0.5); // 1 / (1+1)
});
