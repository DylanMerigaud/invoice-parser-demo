import type { ParseError } from "@/lib/api-types";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";

const TITLES: Record<ParseError["code"], string> = {
  rate_limited: "Rate limit reached",
  bad_request: "Couldn't read that file",
  validation_failed: "Extracted data failed validation",
  no_data: "No invoice data found",
  model_refused: "Couldn't process this document",
  upstream_error: "Extraction service error",
};

export function ErrorPanel({
  error,
  onReset,
}: {
  error: ParseError;
  onReset: () => void;
}) {
  const isValidation = error.code === "validation_failed" && error.issues?.length;

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-danger-line">
        <div className="flex gap-3 px-5 py-4">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
            <AlertIcon />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-ink">
              {TITLES[error.code]}
            </h3>
            <p className="mt-1 text-sm text-ink/70">{error.message}</p>

            {error.code === "rate_limited" &&
              error.retryAfterSeconds != null && (
                <p className="mt-2 text-xs text-muted">
                  Retry available in ~{Math.max(1, Math.ceil(error.retryAfterSeconds / 60))}{" "}
                  minute(s).
                </p>
              )}
          </div>
        </div>
      </Card>

      {/* Zod validation issues — the "production-grade" surfacing */}
      {isValidation && (
        <Card>
          <CardHeader>
            <CardTitle>Schema validation errors</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-xs text-muted">
              The model returned data, but it didn&apos;t satisfy the Zod
              schema. Each row is the failing field path and reason — the API
              refuses to return unvalidated data rather than guess.
            </p>
            <ul className="flex flex-col divide-y divide-line">
              {error.issues!.map((issue, i) => (
                <li
                  key={i}
                  className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-3"
                >
                  <code className="shrink-0 rounded bg-canvas px-1.5 py-0.5 font-mono text-xs text-accent">
                    {issue.path}
                  </code>
                  <span className="text-sm text-ink/80">{issue.message}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <div>
        <button
          onClick={onReset}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function AlertIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
