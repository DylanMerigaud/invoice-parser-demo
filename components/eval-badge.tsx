import type { EvalResults } from "@/lib/eval-results";

/**
 * Compact "proof" strip rendered on the landing page from eval/results.json.
 * Shows headline accuracy + anomaly precision/recall from the last real eval
 * run, so a visitor sees evidence the parser is measured, not just asserted.
 *
 * Renders nothing when results are absent (eval never run) — graceful.
 */
export function EvalBadge({ results }: { results: EvalResults | null }) {
  if (!results) return null;

  const ran = new Date(results.ranAt);
  const ranLabel = Number.isNaN(ran.getTime())
    ? null
    : ran.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok-soft text-[11px] font-bold text-ok">
            ✓
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Eval results
          </span>
        </div>
        <span className="font-mono text-[11px] text-muted">
          {results.samples} samples · {results.model}
          {ranLabel ? ` · ${ranLabel}` : ""}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat
          label="Field accuracy"
          value={pct(results.fieldAccuracy)}
          sub={`${results.fieldsCorrect}/${results.fieldsTotal} fields`}
        />
        <Stat
          label="Anomaly precision"
          value={pct(results.anomaly.precision)}
          sub={`${results.anomaly.tp}/${results.anomaly.tp + results.anomaly.fp} flags`}
        />
        <Stat
          label="Anomaly recall"
          value={pct(results.anomaly.recall)}
          sub={`${results.anomaly.tp}/${results.anomaly.tp + results.anomaly.fn} caught`}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="tnum text-xl font-semibold text-ink">{value}</span>
      <span className="text-[11px] text-muted">{sub}</span>
    </div>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
