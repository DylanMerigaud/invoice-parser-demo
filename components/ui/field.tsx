import { cn } from "@/lib/utils";

/** A labeled key/value pair used in the vendor & meta cards. */
export function Field({
  label,
  value,
  mono = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd
        className={cn(
          "text-sm text-ink",
          mono && "font-mono text-[13px]",
        )}
      >
        {value || <span className="text-muted">—</span>}
      </dd>
    </div>
  );
}
