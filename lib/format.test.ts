import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, formatNumber, formatDate } from "./format";

/** Tests for the display helpers — these are what the user actually sees. */

/** Intl inserts U+00A0 (non-breaking space); normalize to a plain space. */
function nbsp(s: string): string {
  return s.replace(/ /g, " ");
}

test("formatMoney: known currency renders with its symbol", () => {
  assert.equal(formatMoney(1234.5, "USD"), "$1,234.50");
  assert.equal(formatMoney(1234.5, "EUR"), "€1,234.50");
});

test("formatMoney: currency code is case-insensitive", () => {
  assert.equal(formatMoney(10, "usd"), "$10.00");
});

test("formatMoney: an unknown but well-formed code renders with the code itself", () => {
  // Intl accepts any 3-letter code and shows it literally (it doesn't throw on
  // "ZZZ"), so the amount still formats correctly with the code as the symbol.
  assert.equal(nbsp(formatMoney(1234.5, "ZZZ")), "ZZZ 1,234.50");
});

test("formatMoney: missing currency falls back to a plain number", () => {
  assert.equal(formatMoney(1234.5, null), "1,234.50");
  assert.equal(formatMoney(1234.5, undefined), "1,234.50");
  assert.equal(formatMoney(1234.5, ""), "1,234.50");
});

test("formatMoney: always shows two decimals", () => {
  assert.equal(formatMoney(5, "USD"), "$5.00");
  assert.equal(formatMoney(5.1, "USD"), "$5.10");
});

test("formatNumber: integers render without forced decimals", () => {
  assert.equal(formatNumber(40), "40");
  assert.equal(formatNumber(1000), "1,000");
});

test("formatNumber: fractional quantities are preserved", () => {
  assert.equal(formatNumber(2.5), "2.5");
  assert.equal(formatNumber(0.125), "0.125");
});

test("formatDate: ISO date renders as a readable label (UTC, no shift)", () => {
  assert.equal(formatDate("2024-03-15"), "Mar 15, 2024");
  // Jan 1 must not slip to Dec 31 of the prior year via timezone.
  assert.equal(formatDate("2024-01-01"), "Jan 1, 2024");
});

test("formatDate: absent date renders an em dash", () => {
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate(undefined), "—");
  assert.equal(formatDate(""), "—");
});

test("formatDate: an unparseable string is returned as-is", () => {
  assert.equal(formatDate("not-a-date"), "not-a-date");
});
