import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  InvoiceSchema,
  INVOICE_JSON_SCHEMA,
  SCHEMA_DESCRIPTION,
  type Invoice,
} from "./schema";

/** The model used for extraction. Sonnet 4.6 reads the PDF directly (vision). */
export const MODEL = "claude-sonnet-4-6";

/**
 * Structured, tagged result of an extraction attempt. The route handler maps
 * each variant to a distinct HTTP status + UI state — nothing throws past here
 * except genuinely unexpected errors.
 */
export type ExtractionResult =
  | { ok: true; invoice: Invoice; usage: TokenUsage }
  | { ok: false; kind: "validation"; issues: ValidationIssue[]; raw: string }
  | { ok: false; kind: "no_json"; raw: string }
  | { ok: false; kind: "refusal"; message: string }
  | { ok: false; kind: "api_error"; status?: number; message: string };

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface TokenUsage {
  input: number;
  output: number;
}

const SYSTEM_PROMPT = `You are a meticulous invoice data-extraction engine for an accounts-payable system. You are given a single invoice as a PDF document and must extract its key fields into a strict JSON object.

Output schema (TypeScript-style; "?" marks optional fields that may be omitted or null):
${SCHEMA_DESCRIPTION}

Rules:
- Return ONLY the data that is actually present in the document. Never invent, guess, or infer values that are not on the invoice.
- If an optional field (address, taxId, dueDate, tax) is not present, omit it or set it to null. Do NOT fabricate it.
- Dates must be ISO-8601 calendar dates in the form YYYY-MM-DD. Convert any date format you see (e.g. "15 Mar 2024", "03/15/2024", "2024.03.15") to this form. If a date's day is ambiguous, prefer the interpretation consistent with other dates on the invoice.
- "currency" must be the 3-letter ISO-4217 code (USD, EUR, GBP, JPY, ...). Infer it from a currency symbol (£ -> GBP, € -> EUR, $ -> USD unless another dollar currency is clearly indicated) or an explicit code on the document.
- Numbers must be plain JSON numbers with no currency symbols, thousands separators, or units. Use a period as the decimal separator. Parse localized number formats (e.g. "1.234,56" -> 1234.56) correctly.
- "lineItems" is one entry per billed line. "amount" is that line's total. If a line shows only a total (no qty/unit price), set qty to 1 and unitPrice to the amount.
- "subtotal" is the pre-tax sum; "total" is the final amount due. If the invoice shows only one total and no separate subtotal, set subtotal equal to that amount.
- Do NOT silently "fix" the invoice's math. Transcribe the numbers as printed, even if they don't add up — a downstream checker will flag inconsistencies.
- Extract the data exactly as printed even for messy, scanned, low-quality, or non-English invoices. Translate field positions, not values: keep vendor names and descriptions in their original language.`;

let cachedClient: Anthropic | null = null;

/** Lazily construct the client so a missing key surfaces as a handled error. */
function getClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new MissingApiKeyError();
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

class MissingApiKeyError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set");
    this.name = "MissingApiKeyError";
  }
}

/**
 * Send a base64-encoded PDF to Claude and return a validated Invoice (or a
 * tagged failure). This is the shared extraction core used by both the API
 * route and the eval harness.
 */
export async function extractInvoice(
  pdfBase64: string,
): Promise<ExtractionResult> {
  let message: Anthropic.Message;
  try {
    message = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      // Extraction is transcription, not open-ended reasoning: keep thinking
      // off for speed and lower cost. The JSON schema is the real constraint.
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      output_config: {
        format: {
          type: "json_schema",
          schema: INVOICE_JSON_SCHEMA,
        },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            {
              type: "text",
              text: "Extract this invoice into the required JSON object. Return only the JSON.",
            },
          ],
        },
      ],
    });
  } catch (err) {
    return mapApiError(err);
  }

  if (message.stop_reason === "refusal") {
    return {
      ok: false,
      kind: "refusal",
      message:
        "The model declined to process this document. Please try a different file.",
    };
  }

  const usage: TokenUsage = {
    input: message.usage.input_tokens,
    output: message.usage.output_tokens,
  };

  const raw = firstText(message);
  if (!raw) {
    return { ok: false, kind: "no_json", raw: "" };
  }

  const json = extractJsonObject(raw);
  if (json === undefined) {
    return { ok: false, kind: "no_json", raw };
  }

  const parsed = InvoiceSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      kind: "validation",
      issues: toIssues(parsed.error),
      raw,
    };
  }

  return { ok: true, invoice: normalize(parsed.data), usage };
}

/** Concatenate all text blocks of the response. */
function firstText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Pull a JSON object out of the model's text. With structured outputs the whole
 * response should already be valid JSON, but we stay defensive: strip code
 * fences and, as a last resort, slice from the first "{" to the last "}".
 */
function extractJsonObject(text: string): unknown {
  const tryParse = (s: string): unknown | undefined => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(text);
  if (direct !== undefined) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const inner = tryParse(fenced[1]);
    if (inner !== undefined) return inner;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const sliced = tryParse(text.slice(start, end + 1));
    if (sliced !== undefined) return sliced;
  }

  return undefined;
}

function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({
    path: i.path.length ? i.path.join(".") : "(root)",
    message: i.message,
  }));
}

/** Normalize a few fields post-validation (uppercase currency, trim strings). */
function normalize(inv: Invoice): Invoice {
  return {
    ...inv,
    currency: inv.currency.toUpperCase(),
  };
}

function mapApiError(err: unknown): ExtractionResult {
  if (err instanceof MissingApiKeyError) {
    return {
      ok: false,
      kind: "api_error",
      message:
        "Server is missing its ANTHROPIC_API_KEY. Set it in the environment to enable parsing.",
    };
  }
  if (err instanceof APIError) {
    return {
      ok: false,
      kind: "api_error",
      status: err.status,
      message: friendlyApiMessage(err),
    };
  }
  return {
    ok: false,
    kind: "api_error",
    message: "Unexpected error while contacting the extraction model.",
  };
}

function friendlyApiMessage(err: APIError): string {
  switch (err.status) {
    case 401:
      return "The configured Anthropic API key was rejected (401). Check the key.";
    case 429:
      return "The extraction model is rate-limited upstream (429). Try again shortly.";
    case 400:
      return "The model rejected this request (400) — the PDF may be malformed or unsupported.";
    default:
      if (err.status && err.status >= 500) {
        return "The extraction model is temporarily unavailable. Please retry.";
      }
      return "The extraction model returned an error. Please try again.";
  }
}
