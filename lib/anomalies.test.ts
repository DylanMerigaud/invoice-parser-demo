import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAnomalies, type AnomalyCode } from "./anomalies";
import type { Invoice } from "./schema";

/**
 * Unit tests for the anomaly detector. Run with `pnpm test` (Node's built-in
 * test runner via tsx — no extra deps). These pin the exact behavior the UI and
 * the eval harness both depend on, including the rounding-tolerance edges.
 */

// A clean, fully-reconciling invoice. Helpers below mutate clones of this.
function baseInvoice(): Invoice {
  return {
    vendor: { name: "Test Co", address: null, taxId: null },
    invoiceNumber: "INV-1",
    issueDate: "2024-01-10",
    dueDate: "2024-02-09",
    currency: "USD",
    lineItems: [
      { description: "Widget", qty: 2, unitPrice: 50, amount: 100 },
      { description: "Gadget", qty: 1, unitPrice: 100, amount: 100 },
    ],
    subtotal: 200,
    tax: 16,
    total: 216,
  };
}

/** Codes fired on an invoice, sorted for stable comparison. */
function codes(inv: Invoice): AnomalyCode[] {
  return detectAnomalies(inv)
    .map((a) => a.code)
    .sort();
}

test("clean invoice fires no anomalies", () => {
  assert.deepEqual(codes(baseInvoice()), []);
});

test("line items not summing to subtotal → line_items_sum_mismatch", () => {
  const inv = baseInvoice();
  inv.subtotal = 250; // lines sum to 200
  inv.total = 266; // keep subtotal+tax==total so only the sum check fires
  assert.deepEqual(codes(inv), ["line_items_sum_mismatch"]);
});

test("subtotal + tax not equal to total → totals_mismatch", () => {
  const inv = baseInvoice();
  inv.total = 999;
  assert.ok(codes(inv).includes("totals_mismatch"));
});

test("implausibly high tax rate → tax_rate_inconsistent (warning)", () => {
  const inv = baseInvoice();
  inv.tax = 120; // 60% of subtotal
  inv.total = 320;
  const fired = detectAnomalies(inv);
  const taxFlag = fired.find((a) => a.code === "tax_rate_inconsistent");
  assert.ok(taxFlag, "expected a tax-rate flag");
  assert.equal(taxFlag.severity, "warning");
});

test("negative tax → tax_rate_inconsistent", () => {
  const inv = baseInvoice();
  inv.tax = -16;
  inv.total = 184;
  assert.ok(codes(inv).includes("tax_rate_inconsistent"));
});

test("due date before issue date → due_before_issue", () => {
  const inv = baseInvoice();
  inv.dueDate = "2024-01-01"; // before issueDate 2024-01-10
  assert.deepEqual(codes(inv), ["due_before_issue"]);
});

test("same-day due date is allowed (no anomaly)", () => {
  const inv = baseInvoice();
  inv.dueDate = inv.issueDate;
  assert.deepEqual(codes(inv), []);
});

test("missing total (non-positive) → missing_total", () => {
  const inv = baseInvoice();
  inv.total = 0;
  inv.subtotal = 0;
  inv.lineItems = [{ description: "x", qty: 0, unitPrice: 0, amount: 0 }];
  inv.tax = 0;
  assert.ok(codes(inv).includes("missing_total"));
});

test("blank currency → missing_currency", () => {
  const inv = baseInvoice();
  // Force a blank currency past the type (simulates a model sentinel).
  (inv as { currency: string }).currency = "   ";
  assert.ok(codes(inv).includes("missing_currency"));
});

test("duplicate line items → duplicate_line_items (warning)", () => {
  const inv = baseInvoice();
  inv.lineItems = [
    { description: "Seat", qty: 1, unitPrice: 100, amount: 100 },
    { description: "Seat", qty: 1, unitPrice: 100, amount: 100 },
  ];
  inv.subtotal = 200;
  inv.total = 216;
  const fired = detectAnomalies(inv);
  const dup = fired.find((a) => a.code === "duplicate_line_items");
  assert.ok(dup);
  assert.equal(dup.severity, "warning");
});

test("tax omitted entirely is fine (subtotal == total)", () => {
  const inv = baseInvoice();
  inv.tax = null;
  inv.total = inv.subtotal; // 200
  assert.deepEqual(codes(inv), []);
});

test("sub-cent rounding drift is tolerated", () => {
  const inv = baseInvoice();
  // Lines sum to 200.00; nudge subtotal by half a cent — should NOT flag.
  inv.subtotal = 200.005;
  inv.total = 216.005;
  assert.deepEqual(codes(inv), []);
});

test("errors are sorted before warnings", () => {
  const inv = baseInvoice();
  inv.subtotal = 250; // error: sum mismatch
  inv.total = 266;
  inv.lineItems = [
    { description: "A", qty: 1, unitPrice: 100, amount: 100 },
    { description: "A", qty: 1, unitPrice: 100, amount: 100 }, // warning: dup
  ];
  const fired = detectAnomalies(inv);
  const firstWarningIdx = fired.findIndex((a) => a.severity === "warning");
  const lastErrorIdx = fired.map((a) => a.severity).lastIndexOf("error");
  assert.ok(lastErrorIdx < firstWarningIdx, "all errors should precede warnings");
});
