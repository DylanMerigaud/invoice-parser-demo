import type { Invoice, LineItem } from "./schema";

/**
 * Anomaly detection runs AFTER extraction + Zod validation. It's pure (no I/O)
 * so the eval harness exercises the exact same code the UI renders.
 *
 * Each detector returns zero or more `Anomaly` objects. `severity: "error"`
 * means the document is internally inconsistent (numbers don't reconcile, dates
 * are impossible); `severity: "warning"` means something looks off but may be
 * legitimate (an unusual tax rate, repeated line items).
 */

export type Severity = "error" | "warning";

/** Stable machine codes — the eval harness scores precision/recall against these. */
export type AnomalyCode =
  | "line_items_sum_mismatch"
  | "totals_mismatch"
  | "tax_rate_inconsistent"
  | "due_before_issue"
  | "missing_currency"
  | "missing_total"
  | "duplicate_line_items";

export interface Anomaly {
  code: AnomalyCode;
  severity: Severity;
  /** Human-readable explanation shown in the UI. */
  message: string;
  /** Optional supporting numbers, surfaced in the UI as a detail line. */
  detail?: string;
}

/**
 * Money tolerance. Invoices accumulate per-line rounding, so we allow one cent
 * per line item plus a one-cent base, with a small relative floor for very
 * large invoices where currency units may be large.
 */
function moneyTolerance(lineCount: number, scale: number): number {
  const absolute = 0.01 * lineCount + 0.01;
  const relative = Math.abs(scale) * 0.001; // 0.1% of the compared magnitude
  return Math.max(absolute, relative);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function money(n: number, currency: string | null | undefined): string {
  const value = round2(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${value} ${currency}` : value;
}

/** Line items should sum to the subtotal (or, if no subtotal, the total). */
function checkLineItemsSum(inv: Invoice): Anomaly[] {
  if (inv.lineItems.length === 0) return [];
  const sum = round2(inv.lineItems.reduce((acc, li) => acc + li.amount, 0));
  const target = inv.subtotal;
  const tol = moneyTolerance(inv.lineItems.length, target);
  if (Math.abs(sum - target) > tol) {
    return [
      {
        code: "line_items_sum_mismatch",
        severity: "error",
        message: "Line items don't add up to the subtotal.",
        detail: `Σ line amounts = ${money(sum, inv.currency)}, but subtotal = ${money(
          target,
          inv.currency,
        )} (off by ${money(Math.abs(sum - target), inv.currency)}).`,
      },
    ];
  }
  return [];
}

/** subtotal + tax should equal total. */
function checkTotals(inv: Invoice): Anomaly[] {
  const tax = inv.tax ?? 0;
  const expected = round2(inv.subtotal + tax);
  const tol = moneyTolerance(inv.lineItems.length, inv.total);
  if (Math.abs(expected - inv.total) > tol) {
    return [
      {
        code: "totals_mismatch",
        severity: "error",
        message: "Subtotal plus tax doesn't equal the total.",
        detail: `${money(inv.subtotal, inv.currency)} + ${money(
          tax,
          inv.currency,
        )} tax = ${money(expected, inv.currency)}, but total = ${money(
          inv.total,
          inv.currency,
        )}.`,
      },
    ];
  }
  return [];
}

/**
 * The implied tax rate (tax / subtotal) should be a plausible sales/VAT rate.
 * We flag rates that are negative, or implausibly high (> 40%) — both usually
 * indicate a misread tax figure. Only runs when both tax and a non-zero
 * subtotal are present.
 */
function checkTaxRate(inv: Invoice): Anomaly[] {
  if (inv.tax == null || inv.subtotal === 0) return [];
  const rate = inv.tax / inv.subtotal;
  const pct = (rate * 100).toFixed(1);
  if (rate < 0) {
    return [
      {
        code: "tax_rate_inconsistent",
        severity: "warning",
        message: "Tax amount is negative relative to the subtotal.",
        detail: `Implied tax rate is ${pct}%.`,
      },
    ];
  }
  if (rate > 0.4) {
    return [
      {
        code: "tax_rate_inconsistent",
        severity: "warning",
        message: "Tax rate looks unusually high for an invoice.",
        detail: `Implied tax rate is ${pct}% of the subtotal — double-check the tax figure.`,
      },
    ];
  }
  return [];
}

/** Due date must not precede the issue date. */
function checkDueBeforeIssue(inv: Invoice): Anomaly[] {
  if (!inv.dueDate) return [];
  const issue = Date.parse(inv.issueDate);
  const due = Date.parse(inv.dueDate);
  if (Number.isNaN(issue) || Number.isNaN(due)) return [];
  if (due < issue) {
    return [
      {
        code: "due_before_issue",
        severity: "error",
        message: "Due date is earlier than the issue date.",
        detail: `Issued ${inv.issueDate}, due ${inv.dueDate}.`,
      },
    ];
  }
  return [];
}

/**
 * Missing-field checks. After Zod, `currency` and `total` are always present
 * structurally, but the model may emit sentinel/empty-ish values the schema
 * can't fully forbid (e.g. a currency it guessed). We treat a blank-after-trim
 * currency as missing, and a non-positive total as a missing/garbage total.
 */
function checkMissing(inv: Invoice): Anomaly[] {
  const out: Anomaly[] = [];
  if (!inv.currency || inv.currency.trim() === "") {
    out.push({
      code: "missing_currency",
      severity: "error",
      message: "No currency was found on the invoice.",
    });
  }
  if (inv.total == null || inv.total <= 0) {
    out.push({
      code: "missing_total",
      severity: "error",
      message: "No valid total amount was found on the invoice.",
    });
  }
  return out;
}

/** Two line items with the same description, qty, unitPrice and amount. */
function checkDuplicateLineItems(inv: Invoice): Anomaly[] {
  const seen = new Map<string, number>();
  const key = (li: LineItem) =>
    [
      li.description.trim().toLowerCase(),
      round2(li.qty),
      round2(li.unitPrice),
      round2(li.amount),
    ].join("|");
  for (const li of inv.lineItems) {
    const k = key(li);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, count]) => count > 1);
  if (dupes.length === 0) return [];
  const total = dupes.reduce((acc, [, count]) => acc + count, 0);
  return [
    {
      code: "duplicate_line_items",
      severity: "warning",
      message: "Some line items appear more than once.",
      detail: `${dupes.length} description${
        dupes.length > 1 ? "s" : ""
      } repeated (${total} rows total) — could be a duplicate charge or just identical items.`,
    },
  ];
}

const DETECTORS: Array<(inv: Invoice) => Anomaly[]> = [
  checkMissing,
  checkLineItemsSum,
  checkTotals,
  checkTaxRate,
  checkDueBeforeIssue,
  checkDuplicateLineItems,
];

/** Run every detector and return all anomalies, errors first. */
export function detectAnomalies(invoice: Invoice): Anomaly[] {
  const all = DETECTORS.flatMap((d) => d(invoice));
  const order: Record<Severity, number> = { error: 0, warning: 1 };
  return all.sort((a, b) => order[a.severity] - order[b.severity]);
}
