import { test } from "node:test";
import assert from "node:assert/strict";
import { InvoiceSchema, INVOICE_JSON_SCHEMA, type Invoice } from "./schema";

/**
 * Tests for the extraction schema — the validation boundary the whole app
 * leans on. These pin what is accepted vs rejected, since that's the contract
 * between the model's output and everything downstream.
 */

/** A minimal valid invoice; helpers below tweak clones of it. */
function valid(): Invoice {
  return {
    vendor: { name: "Acme Co", address: "1 A St", taxId: "US-1" },
    invoiceNumber: "INV-1",
    issueDate: "2024-03-01",
    dueDate: "2024-03-31",
    currency: "USD",
    lineItems: [{ description: "Widget", qty: 2, unitPrice: 5, amount: 10 }],
    subtotal: 10,
    tax: 0.8,
    total: 10.8,
  };
}

test("accepts a well-formed invoice", () => {
  assert.equal(InvoiceSchema.safeParse(valid()).success, true);
});

test("optional fields may be omitted entirely", () => {
  const inv = valid();
  delete (inv as Partial<Invoice>).dueDate;
  delete (inv as Partial<Invoice>).tax;
  delete (inv.vendor as Partial<Invoice["vendor"]>).address;
  delete (inv.vendor as Partial<Invoice["vendor"]>).taxId;
  assert.equal(InvoiceSchema.safeParse(inv).success, true);
});

test("optional fields may be null", () => {
  const r = InvoiceSchema.safeParse({
    ...valid(),
    dueDate: null,
    tax: null,
    vendor: { name: "Acme Co", address: null, taxId: null },
  });
  assert.equal(r.success, true);
});

test("rejects a missing required field (vendor name)", () => {
  const inv = valid();
  inv.vendor = { name: "" } as Invoice["vendor"];
  const r = InvoiceSchema.safeParse(inv);
  assert.equal(r.success, false);
});

test("rejects a non-3-letter currency", () => {
  for (const bad of ["US", "DOLLAR", "usd ", "12A"]) {
    assert.equal(
      InvoiceSchema.safeParse({ ...valid(), currency: bad }).success,
      false,
      `expected "${bad}" to be rejected`,
    );
  }
});

test("rejects a non-ISO or impossible date", () => {
  assert.equal(InvoiceSchema.safeParse({ ...valid(), issueDate: "03/01/2024" }).success, false);
  assert.equal(InvoiceSchema.safeParse({ ...valid(), issueDate: "2024-13-40" }).success, false);
});

test("rejects a string where a number is expected", () => {
  const r = InvoiceSchema.safeParse({ ...valid(), total: "10.80" });
  assert.equal(r.success, false);
});

test("rejects non-finite amounts (NaN / Infinity)", () => {
  assert.equal(InvoiceSchema.safeParse({ ...valid(), total: Number.NaN }).success, false);
  assert.equal(InvoiceSchema.safeParse({ ...valid(), subtotal: Infinity }).success, false);
});

test("requires at least one line item", () => {
  assert.equal(InvoiceSchema.safeParse({ ...valid(), lineItems: [] }).success, false);
});

test("rejects a line item missing a field", () => {
  const r = InvoiceSchema.safeParse({
    ...valid(),
    lineItems: [{ description: "x", qty: 1, unitPrice: 1 }], // no `amount`
  });
  assert.equal(r.success, false);
});

test("strips/rejects unknown keys (strict)", () => {
  const r = InvoiceSchema.safeParse({ ...valid(), surprise: "nope" });
  assert.equal(r.success, false);
});

test("validation errors carry a field path and message", () => {
  const r = InvoiceSchema.safeParse({ ...valid(), currency: "BAD!" });
  assert.equal(r.success, false);
  if (!r.success) {
    const issue = r.error.issues[0];
    assert.ok(issue);
    assert.deepEqual(issue.path, ["currency"]);
    assert.ok(issue.message.length > 0);
  }
});

test("INVOICE_JSON_SCHEMA is an inline object schema (no $ref wrapper)", () => {
  const s = INVOICE_JSON_SCHEMA as Record<string, unknown>;
  assert.equal(s["type"], "object");
  assert.equal(s["additionalProperties"], false);
  assert.equal("$ref" in s, false);
  assert.equal("$schema" in s, false);
  assert.ok(Array.isArray(s["required"]));
});
