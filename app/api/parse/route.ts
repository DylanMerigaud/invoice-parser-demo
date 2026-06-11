import { NextResponse } from "next/server";
import { extractInvoice, MODEL } from "@/lib/anthropic";
import { detectAnomalies } from "@/lib/anomalies";
import { checkRateLimit, clientIpFrom } from "@/lib/ratelimit";
import type { ParseError, ParseResponse } from "@/lib/api-types";

// Node runtime: we read raw file bytes and call the Anthropic SDK.
export const runtime = "nodejs";
// Never cache an extraction.
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const PDF_MAGIC = "%PDF-"; // every PDF starts with this

function err(
  code: ParseError["code"],
  message: string,
  status: number,
  extra?: Partial<ParseError>,
): NextResponse<ParseResponse> {
  return NextResponse.json<ParseResponse>(
    { ok: false, code, message, ...extra },
    { status },
  );
}

export async function POST(request: Request): Promise<NextResponse<ParseResponse>> {
  const startedAt = Date.now();

  // 1. Rate-limit by IP first — before doing any work or calling the model.
  const ip = clientIpFrom(request.headers);
  const verdict = await checkRateLimit(ip);
  if (!verdict.ok) {
    return err(
      "rate_limited",
      `You've hit the demo limit (5 parses per 10 minutes). Try again in about ${Math.max(
        1,
        Math.ceil(verdict.retryAfterSeconds / 60),
      )} minute(s).`,
      429,
      { retryAfterSeconds: verdict.retryAfterSeconds },
    );
  }

  // 2. Cheap pre-check: reject an oversized body via Content-Length BEFORE
  //    buffering it with formData(). The header can be absent or wrong, so the
  //    post-parse file.size check below stays the authoritative guard — this
  //    just avoids reading a large body into memory when we can see it coming.
  //    (Multipart framing adds overhead, so allow a little slack over MAX_BYTES.)
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES + 1024 * 1024) {
    return err(
      "bad_request",
      `That upload is ${(contentLength / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`,
      413,
    );
  }

  // 3. Parse the multipart upload.
  let file: File | null = null;
  try {
    const form = await request.formData();
    const candidate = form.get("file");
    if (candidate instanceof File) {
      file = candidate;
    }
  } catch {
    return err("bad_request", "Could not read the uploaded form data.", 400);
  }

  if (!file) {
    return err("bad_request", "No file was uploaded. Attach a PDF invoice.", 400);
  }

  // 4. Validate the upload: size, then real PDF magic bytes (don't trust the
  //    content-type header alone).
  if (file.size === 0) {
    return err("bad_request", "The uploaded file is empty.", 400);
  }
  if (file.size > MAX_BYTES) {
    return err(
      "bad_request",
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`,
      400,
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const header = bytes.subarray(0, 5).toString("latin1");
  if (header !== PDF_MAGIC) {
    return err(
      "bad_request",
      "That doesn't look like a PDF. This demo reads PDF invoices only.",
      400,
    );
  }

  // 5. Extract via Claude, then Zod-validate (both inside extractInvoice).
  const result = await extractInvoice(bytes.toString("base64"));

  if (!result.ok) {
    switch (result.kind) {
      case "validation":
        return err(
          "validation_failed",
          "The invoice was read, but the extracted data failed schema validation.",
          422,
          { issues: result.issues },
        );
      case "no_json":
        return err(
          "no_data",
          "The model couldn't find structured invoice data in that document.",
          422,
        );
      case "refusal":
        return err("model_refused", result.message, 422);
      case "api_error":
        return err(
          "upstream_error",
          result.message,
          result.status && result.status === 429 ? 429 : 502,
        );
    }
  }

  // 6. Run anomaly detection over the validated invoice.
  const anomalies = detectAnomalies(result.invoice);

  return NextResponse.json<ParseResponse>(
    {
      ok: true,
      invoice: result.invoice,
      anomalies,
      meta: {
        fileName: file.name || "invoice.pdf",
        model: MODEL,
        usage: result.usage,
        elapsedMs: Date.now() - startedAt,
      },
    },
    { status: 200 },
  );
}

/** Friendly response for accidental GETs. */
export function GET(): NextResponse {
  return NextResponse.json(
    { ok: false, code: "bad_request", message: "POST a PDF as multipart/form-data to this endpoint." },
    { status: 405 },
  );
}
