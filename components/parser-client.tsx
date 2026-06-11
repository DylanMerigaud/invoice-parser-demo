"use client";

import { useCallback, useState } from "react";
import { Dropzone, type SampleInvoice } from "@/components/dropzone";
import { ResultView } from "@/components/result-view";
import { ErrorPanel } from "@/components/error-panel";
import { LANDING_SAMPLES } from "@/lib/samples";
import type { ParseError, ParseResponse, ParseSuccess } from "@/lib/api-types";

type Phase =
  | { status: "idle" }
  | { status: "loading"; label: string }
  | { status: "success"; data: ParseSuccess }
  | { status: "error"; error: ParseError };

const NETWORK_ERROR: ParseError = {
  ok: false,
  code: "upstream_error",
  message: "Couldn't reach the parser. Check your connection and try again.",
};

/** The interactive part of the landing page (upload → parse → render). */
export function ParserClient() {
  const [phase, setPhase] = useState<Phase>({ status: "idle" });

  const parse = useCallback(async (body: FormData, label: string) => {
    setPhase({ status: "loading", label });
    try {
      const res = await fetch("/api/parse", { method: "POST", body });
      const data = (await res.json()) as ParseResponse;
      if (data.ok) {
        setPhase({ status: "success", data });
      } else {
        setPhase({ status: "error", error: data });
      }
    } catch {
      setPhase({ status: "error", error: NETWORK_ERROR });
    }
  }, []);

  const onFile = useCallback(
    (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      void parse(fd, `Reading ${file.name}…`);
    },
    [parse],
  );

  const onSample = useCallback(
    async (sample: SampleInvoice) => {
      setPhase({ status: "loading", label: `Loading "${sample.label}"…` });
      try {
        const res = await fetch(sample.file);
        if (!res.ok) throw new Error("sample fetch failed");
        const blob = await res.blob();
        const fd = new FormData();
        fd.append(
          "file",
          new File([blob], `${sample.id}.pdf`, { type: "application/pdf" }),
        );
        void parse(fd, `Parsing "${sample.label}"…`);
      } catch {
        setPhase({ status: "error", error: NETWORK_ERROR });
      }
    },
    [parse],
  );

  const reset = useCallback(() => setPhase({ status: "idle" }), []);

  if (phase.status === "loading") return <LoadingState label={phase.label} />;
  if (phase.status === "success")
    return <ResultView data={phase.data} onReset={reset} />;
  if (phase.status === "error")
    return <ErrorPanel error={phase.error} onReset={reset} />;

  return (
    <Dropzone samples={LANDING_SAMPLES} onFile={onFile} onSample={onSample} />
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-line bg-surface px-6 py-20">
      <div className="flex items-center gap-3">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <span className="text-sm font-medium text-ink">{label}</span>
      </div>
      <p className="max-w-sm text-center text-xs text-muted">
        Sending the PDF to{" "}
        <span className="font-mono">claude-sonnet-4-6</span>, validating the
        response against the schema, and running anomaly checks.
      </p>
    </div>
  );
}
