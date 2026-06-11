/**
 * Scoring logic for the eval harness. Pure + deterministic so it can be unit-
 * reasoned about. Compares an extracted Invoice against ground truth field by
 * field, and scores anomaly detection as precision/recall over codes.
 */

import type { Invoice } from "@/lib/schema";
import type { AnomalyCode } from "@/lib/anomalies";

/** The flat list of fields we score, in display order. */
export const SCORED_FIELDS = [
  "vendor.name",
  "vendor.address",
  "vendor.taxId",
  "invoiceNumber",
  "issueDate",
  "dueDate",
  "currency",
  "subtotal",
  "tax",
  "total",
  "lineItems",
] as const;

export type ScoredField = (typeof SCORED_FIELDS)[number];

export interface FieldResult {
  field: ScoredField;
  /** null = field not applicable to this sample (e.g. optional + absent in truth). */
  correct: boolean | null;
  expected: string;
  got: string;
}

export interface SampleScore {
  id: string;
  stresses: string;
  /** Hard failure (extraction errored) — counts as all-fields-wrong. */
  failed?: string;
  fields: FieldResult[];
  /** correct / applicable field count for this sample. */
  fieldAccuracy: number;
  anomaly: {
    expected: AnomalyCode[];
    got: AnomalyCode[];
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
  };
}

const MONEY_TOL = 0.02;

function normStr(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function moneyEq(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= MONEY_TOL;
}

function fmtMoney(n: number | null | undefined): string {
  return n == null ? "—" : n.toFixed(2);
}

/**
 * Fuzzy string equality for free-text fields (vendor name, address). The model
 * may legitimately reformat whitespace/punctuation; we accept a match if one
 * normalized string contains the other, or they're equal.
 */
function looseStrEq(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normStr(a);
  const nb = normStr(b);
  if (na === nb) return true;
  if (!na || !nb) return false;
  // Address/name reformatting: accept containment either direction.
  const stripPunct = (x: string) => x.replace(/[.,#\-/]/g, "").replace(/\s+/g, " ").trim();
  const sa = stripPunct(na);
  const sb = stripPunct(nb);
  return sa === sb || sa.includes(sb) || sb.includes(sa);
}

/** Exact equality for codes/identifiers (invoice number, currency, dates). */
function idEq(a: string | null | undefined, b: string | null | undefined): boolean {
  return normStr(a).replace(/\s+/g, "") === normStr(b).replace(/\s+/g, "");
}

/**
 * Line-item scoring: each expected line should have a matching extracted line
 * (description loosely equal AND amount within tolerance). Score is the
 * fraction matched, then thresholded to a boolean (>= 0.999 == fully correct)
 * for the per-field table, but we also expose the fraction in `got`.
 */
function scoreLineItems(
  expected: Invoice["lineItems"],
  got: Invoice["lineItems"],
): { correct: boolean; detail: string } {
  if (expected.length === 0) {
    return { correct: got.length === 0, detail: `${got.length}/0` };
  }
  const used = new Set<number>();
  let matched = 0;
  for (const exp of expected) {
    const idx = got.findIndex(
      (g, i) =>
        !used.has(i) &&
        looseStrEq(exp.description, g.description) &&
        moneyEq(exp.amount, g.amount),
    );
    if (idx !== -1) {
      used.add(idx);
      matched++;
    }
  }
  const frac = matched / expected.length;
  const countPenalty = got.length === expected.length ? "" : ` (got ${got.length})`;
  return {
    correct: frac >= 0.999 && got.length === expected.length,
    detail: `${matched}/${expected.length}${countPenalty}`,
  };
}

/** Compare one extracted invoice to ground truth, field by field. */
export function scoreInvoice(
  expected: Invoice,
  got: Invoice,
): { fields: FieldResult[]; accuracy: number } {
  const fields: FieldResult[] = [];

  const push = (
    field: ScoredField,
    correct: boolean | null,
    exp: string,
    g: string,
  ) => fields.push({ field, correct, expected: exp, got: g });

  // Free-text
  push("vendor.name", looseStrEq(expected.vendor.name, got.vendor.name), expected.vendor.name, got.vendor.name);

  // Optional strings: if truth is absent, applicable only if model invented one.
  const addrApplicable = expected.vendor.address != null;
  push(
    "vendor.address",
    addrApplicable ? looseStrEq(expected.vendor.address, got.vendor.address) : null,
    expected.vendor.address ?? "—",
    got.vendor.address ?? "—",
  );
  const taxApplicable = expected.vendor.taxId != null;
  push(
    "vendor.taxId",
    taxApplicable ? idEq(expected.vendor.taxId, got.vendor.taxId) : null,
    expected.vendor.taxId ?? "—",
    got.vendor.taxId ?? "—",
  );

  // Identifiers / dates (exact)
  push("invoiceNumber", idEq(expected.invoiceNumber, got.invoiceNumber), expected.invoiceNumber, got.invoiceNumber);
  push("issueDate", idEq(expected.issueDate, got.issueDate), expected.issueDate, got.issueDate);
  const dueApplicable = expected.dueDate != null;
  push(
    "dueDate",
    dueApplicable ? idEq(expected.dueDate, got.dueDate) : null,
    expected.dueDate ?? "—",
    got.dueDate ?? "—",
  );
  push("currency", idEq(expected.currency, got.currency), expected.currency, got.currency);

  // Money
  push("subtotal", moneyEq(expected.subtotal, got.subtotal), fmtMoney(expected.subtotal), fmtMoney(got.subtotal));
  const taxAmtApplicable = expected.tax != null;
  push(
    "tax",
    taxAmtApplicable ? moneyEq(expected.tax, got.tax) : null,
    fmtMoney(expected.tax),
    fmtMoney(got.tax),
  );
  push("total", moneyEq(expected.total, got.total), fmtMoney(expected.total), fmtMoney(got.total));

  // Line items
  const li = scoreLineItems(expected.lineItems, got.lineItems);
  push("lineItems", li.correct, `${expected.lineItems.length} items`, li.detail);

  const applicable = fields.filter((f) => f.correct !== null);
  const correct = applicable.filter((f) => f.correct === true).length;
  const accuracy = applicable.length === 0 ? 1 : correct / applicable.length;

  return { fields, accuracy };
}

/** Score anomaly detection for one sample. */
export function scoreAnomalies(
  expected: AnomalyCode[],
  got: AnomalyCode[],
): SampleScore["anomaly"] {
  const expSet = new Set(expected);
  const gotSet = new Set(got);
  const truePositives = [...gotSet].filter((c) => expSet.has(c)).length;
  const falsePositives = [...gotSet].filter((c) => !expSet.has(c)).length;
  const falseNegatives = [...expSet].filter((c) => !gotSet.has(c)).length;
  return {
    expected: [...expSet],
    got: [...gotSet],
    truePositives,
    falsePositives,
    falseNegatives,
  };
}

/** Aggregate precision/recall/F1 across all samples. */
export function aggregateAnomalies(scores: SampleScore[]): {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
} {
  const tp = scores.reduce((a, s) => a + s.anomaly.truePositives, 0);
  const fp = scores.reduce((a, s) => a + s.anomaly.falsePositives, 0);
  const fn = scores.reduce((a, s) => a + s.anomaly.falseNegatives, 0);
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp, fn };
}
