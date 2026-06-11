"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SampleInvoice {
  id: string;
  label: string;
  /** Path under /public, e.g. /samples/clean-acme.pdf */
  file: string;
}

export function Dropzone({
  samples,
  onFile,
  onSample,
  disabled,
}: {
  samples: SampleInvoice[];
  onFile: (file: File) => void;
  onSample: (sample: SampleInvoice) => void;
  disabled?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors",
          dragOver
            ? "border-accent bg-accent-soft"
            : "border-line bg-surface hover:border-accent/50 hover:bg-canvas",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <span
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-xl transition-colors",
            dragOver ? "bg-accent text-white" : "bg-accent-soft text-accent",
          )}
        >
          <UploadIcon />
        </span>
        <div>
          <p className="text-base font-medium text-ink">
            {dragOver ? "Drop to parse" : "Drop an invoice PDF here"}
          </p>
          <p className="mt-1 text-sm text-muted">
            or <span className="text-accent">browse</span> · PDF up to 10 MB
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {samples.length > 0 && (
        <div className="flex flex-col items-center gap-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            No invoice handy? Try an example
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {samples.map((s) => (
              <button
                key={s.id}
                disabled={disabled}
                onClick={() => onSample(s)}
                className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent disabled:pointer-events-none disabled:opacity-60"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
