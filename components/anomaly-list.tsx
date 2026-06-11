import type { Anomaly, Severity } from "@/lib/anomalies";
import { cn } from "@/lib/utils";

const SEVERITY_STYLES: Record<
  Severity,
  { wrap: string; chip: string; label: string; icon: string }
> = {
  error: {
    wrap: "border-danger-line bg-danger-soft",
    chip: "bg-danger text-white",
    label: "Error",
    icon: "✕",
  },
  warning: {
    wrap: "border-warn-line bg-warn-soft",
    chip: "bg-warn text-white",
    label: "Warning",
    icon: "!",
  },
};

export function AnomalyList({ anomalies }: { anomalies: Anomaly[] }) {
  if (anomalies.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-ok-line bg-ok-soft px-4 py-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ok text-xs font-bold text-white">
          ✓
        </span>
        <div className="text-sm">
          <span className="font-semibold text-ok">All checks passed.</span>{" "}
          <span className="text-ink/70">
            Totals reconcile, dates are consistent, no duplicate lines.
          </span>
        </div>
      </div>
    );
  }

  const errors = anomalies.filter((a) => a.severity === "error").length;
  const warnings = anomalies.length - errors;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-xs text-muted">
        {errors > 0 && (
          <span className="font-medium text-danger">
            {errors} error{errors > 1 ? "s" : ""}
          </span>
        )}
        {errors > 0 && warnings > 0 && <span aria-hidden>·</span>}
        {warnings > 0 && (
          <span className="font-medium text-warn">
            {warnings} warning{warnings > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {anomalies.map((a, i) => {
        const s = SEVERITY_STYLES[a.severity];
        return (
          <div
            key={`${a.code}-${i}`}
            className={cn("flex gap-3 rounded-xl border px-4 py-3", s.wrap)}
          >
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                s.chip,
              )}
              aria-hidden
            >
              {s.icon}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-ink">{a.message}</p>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    s.chip,
                  )}
                >
                  {s.label}
                </span>
              </div>
              {a.detail && (
                <p className="mt-1 font-mono text-xs leading-relaxed text-ink/70">
                  {a.detail}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
