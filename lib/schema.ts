import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * The extraction schema is the single source of truth for the whole app:
 *
 *   1. It constrains the model at generation time (compiled to JSON Schema and
 *      passed as `output_config.format` to the Messages API).
 *   2. It validates the model's output at the API boundary (Zod `.safeParse`).
 *   3. Its inferred type (`Invoice`) flows into the UI and the eval harness.
 *
 * Surfacing Zod validation errors in the UI is a deliberate "production-grade"
 * signal: the model output is never trusted, it's verified.
 */

// A 3-letter ISO-4217-ish currency code. We don't enumerate every code (that
// would bloat the JSON schema and reject valid-but-rare currencies); we just
// enforce the shape and uppercase it.
const Currency = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, "currency must be a 3-letter code, e.g. USD, EUR, GBP");

// Dates are ISO-8601 calendar dates (YYYY-MM-DD). We validate the format and
// that it's a real date.
const IsoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be ISO-8601 (YYYY-MM-DD)")
  .refine((s) => !Number.isNaN(Date.parse(s)), "date is not a valid calendar date");

// Monetary / numeric amounts. The model is instructed to return plain numbers,
// but we coerce defensively in case a numeric string slips through.
const Amount = z
  .number({ invalid_type_error: "expected a number" })
  .finite("must be a finite number");

const LineItem = z
  .object({
    description: z.string().trim().min(1, "line item needs a description"),
    qty: Amount.describe("quantity for this line item"),
    unitPrice: Amount.describe("price per unit"),
    amount: Amount.describe("line total (typically qty x unitPrice)"),
  })
  .strict();

const Vendor = z
  .object({
    name: z.string().trim().min(1, "vendor name is required"),
    address: z.string().trim().min(1).nullish(),
    taxId: z.string().trim().min(1).nullish(),
  })
  .strict();

export const InvoiceSchema = z
  .object({
    vendor: Vendor,
    invoiceNumber: z.string().trim().min(1, "invoice number is required"),
    issueDate: IsoDate,
    dueDate: IsoDate.nullish(),
    currency: Currency,
    lineItems: z
      .array(LineItem)
      .min(1, "at least one line item is required"),
    subtotal: Amount,
    tax: Amount.nullish(),
    total: Amount,
  })
  .strict();

export type Invoice = z.infer<typeof InvoiceSchema>;
export type LineItem = z.infer<typeof LineItem>;

/**
 * JSON Schema handed to the Anthropic API as `output_config.format`. We build
 * it from the SAME Zod object so the model and the validator can never drift.
 *
 * The API's structured-output JSON-schema subset does not support some
 * keywords (e.g. string `pattern`, numeric bounds). `zod-to-json-schema` emits
 * them, but they are advisory for the model and harmless — Zod remains the
 * authoritative validator on the way back in.
 *
 * We emit an INLINE root object (no `name`, so no `$ref`/`definitions` wrapper)
 * and strip the `$schema` meta-key — the cleanest shape to hand the structured-
 * output API. `$refStrategy: "none"` keeps nested objects inlined too.
 */
function buildInvoiceJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(InvoiceSchema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;
  delete schema["$schema"];
  return schema;
}

export const INVOICE_JSON_SCHEMA = buildInvoiceJsonSchema();

/** Human-readable summary of the schema, embedded in the system prompt. */
export const SCHEMA_DESCRIPTION = `{
  "vendor": {
    "name": string,            // required — the company issuing the invoice
    "address"?: string | null, // street/city/country if present
    "taxId"?: string | null    // VAT / tax / EIN number if present
  },
  "invoiceNumber": string,      // required — the invoice's own identifier
  "issueDate": "YYYY-MM-DD",    // required — date the invoice was issued
  "dueDate"?: "YYYY-MM-DD" | null,
  "currency": "XXX",            // required — 3-letter ISO code (USD, EUR, GBP, ...)
  "lineItems": [                // required — one entry per billed line
    {
      "description": string,
      "qty": number,
      "unitPrice": number,
      "amount": number          // the line total
    }
  ],
  "subtotal": number,           // required — sum of line amounts before tax
  "tax"?: number | null,        // tax/VAT amount if shown
  "total": number               // required — final amount due
}`;
