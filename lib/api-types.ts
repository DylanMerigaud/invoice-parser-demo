import type { Invoice } from "./schema";
import type { Anomaly } from "./anomalies";
import type { ValidationIssue, TokenUsage } from "./anthropic";

/**
 * The wire contract for POST /api/parse. The client and server both import
 * these types, so a change to the response shape is a compile error on both
 * sides — not a runtime surprise.
 */

export interface ParseSuccess {
  ok: true;
  invoice: Invoice;
  anomalies: Anomaly[];
  meta: {
    fileName: string;
    model: string;
    usage: TokenUsage;
    elapsedMs: number;
  };
}

/** Stable machine-readable failure codes, each mapped to a distinct UI state. */
type ParseErrorCode =
  | "rate_limited"
  | "bad_request"
  | "validation_failed"
  | "no_data"
  | "model_refused"
  | "upstream_error";

export interface ParseError {
  ok: false;
  code: ParseErrorCode;
  message: string;
  /** Present only for validation_failed — the Zod issues to surface in the UI. */
  issues?: ValidationIssue[];
  /** Present only for rate_limited. */
  retryAfterSeconds?: number;
}

export type ParseResponse = ParseSuccess | ParseError;
