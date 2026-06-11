import type { ParseSuccess } from "@/lib/api-types";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { AnomalyList } from "@/components/anomaly-list";
import { formatMoney, formatNumber, formatDate } from "@/lib/format";

export function ResultView({
  data,
  onReset,
}: {
  data: ParseSuccess;
  onReset: () => void;
}) {
  const { invoice, anomalies, meta } = data;

  return (
    <div className="flex flex-col gap-5">
      {/* Header row: file name + reparse */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <PdfIcon />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">
              {meta.fileName}
            </p>
            <p className="text-xs text-muted">
              Extracted with {meta.model} · {meta.elapsedMs} ms ·{" "}
              {meta.usage.input.toLocaleString()} in /{" "}
              {meta.usage.output.toLocaleString()} out tokens
            </p>
          </div>
        </div>
        <button
          onClick={onReset}
          className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas"
        >
          Parse another
        </button>
      </div>

      {/* Anomalies first — it's the value prop */}
      <AnomalyList anomalies={anomalies} />

      {/* Vendor + meta */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vendor</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="flex flex-col gap-3">
              <Field label="Name" value={invoice.vendor.name} />
              <Field label="Address" value={invoice.vendor.address ?? null} />
              <Field
                label="Tax ID"
                value={invoice.vendor.taxId ?? null}
                mono
              />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice details</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Invoice #" value={invoice.invoiceNumber} mono />
              <Field label="Currency" value={invoice.currency} mono />
              <Field label="Issue date" value={formatDate(invoice.issueDate)} />
              <Field
                label="Due date"
                value={invoice.dueDate ? formatDate(invoice.dueDate) : null}
              />
            </dl>
          </CardBody>
        </Card>
      </div>

      {/* Line items */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Line items</CardTitle>
          <span className="text-[11px] font-medium text-muted">
            {invoice.lineItems.length} row
            {invoice.lineItems.length === 1 ? "" : "s"}
          </span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-2.5 font-medium">Description</th>
                <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  Unit price
                </th>
                <th className="px-5 py-2.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((li, i) => (
                <tr
                  key={i}
                  className="border-b border-line/60 last:border-0 hover:bg-canvas/60"
                >
                  <td className="px-5 py-2.5 text-ink">{li.description}</td>
                  <td className="tnum px-3 py-2.5 text-right text-ink/80">
                    {formatNumber(li.qty)}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right text-ink/80">
                    {formatMoney(li.unitPrice, invoice.currency)}
                  </td>
                  <td className="tnum px-5 py-2.5 text-right font-medium text-ink">
                    {formatMoney(li.amount, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals footer */}
        <div className="border-t border-line px-5 py-4">
          <dl className="ml-auto flex w-full max-w-xs flex-col gap-1.5">
            <TotalRow
              label="Subtotal"
              value={formatMoney(invoice.subtotal, invoice.currency)}
            />
            {invoice.tax != null && (
              <TotalRow
                label="Tax"
                value={formatMoney(invoice.tax, invoice.currency)}
              />
            )}
            <div className="mt-1 border-t border-line pt-2">
              <TotalRow
                label="Total"
                value={formatMoney(invoice.total, invoice.currency)}
                emphasize
              />
            </div>
          </dl>
        </div>
      </Card>
    </div>
  );
}

function TotalRow({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt
        className={
          emphasize
            ? "text-sm font-semibold text-ink"
            : "text-sm text-muted"
        }
      >
        {label}
      </dt>
      <dd
        className={
          emphasize
            ? "tnum text-base font-bold text-ink"
            : "tnum text-sm text-ink"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function PdfIcon() {
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
