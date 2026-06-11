/**
 * Eval harness entry point.
 *
 *   pnpm eval                 # run every sample
 *   pnpm eval clean-acme ...  # run only the named samples
 *
 * For each sample PDF it runs the REAL extraction pipeline (the same
 * `extractInvoice` the API route uses) plus the anomaly detector, then scores:
 *   • per-field extraction accuracy (field-level match %)
 *   • anomaly detection precision / recall / F1
 *
 * This is what proves the parser survives varied real-world formats, not just
 * one happy-path demo PDF.
 *
 * Requires ANTHROPIC_API_KEY (loaded from .env.local / .env). Each sample is
 * one Claude call — running all 8 costs a few cents.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractInvoice, MODEL } from "@/lib/anthropic";
import { detectAnomalies, type AnomalyCode } from "@/lib/anomalies";
import { InvoiceSchema, type Invoice } from "@/lib/schema";
import type { EvalResults } from "@/lib/eval-results";
import {
  scoreInvoice,
  scoreAnomalies,
  aggregateAnomalies,
  SCORED_FIELDS,
  type SampleScore,
  type ScoredField,
} from "./score";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SAMPLES_DIR = join(HERE, "samples");

// ── ANSI helpers (no dependency) ────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};
const useColor = process.stdout.isTTY;
const c = (code: string, s: string) => (useColor ? `${code}${s}${C.reset}` : s);

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(join(ROOT, f));
    } catch {
      /* file absent — fine */
    }
  }
}

interface ExpectedFile {
  stresses: string;
  expected: Invoice;
  expectedAnomalies: AnomalyCode[];
}

async function discoverSamples(filter: string[]): Promise<string[]> {
  const files = await readdir(SAMPLES_DIR);
  const ids = files
    .filter((f) => f.endsWith(".pdf"))
    .map((f) => f.replace(/\.pdf$/, ""))
    .sort();
  if (filter.length === 0) return ids;
  return ids.filter((id) => filter.includes(id));
}

async function runSample(id: string, dryRun: boolean): Promise<SampleScore> {
  const pdf = await readFile(join(SAMPLES_DIR, `${id}.pdf`));
  const expectedRaw = await readFile(join(SAMPLES_DIR, `${id}.expected.json`), "utf8");
  const truth = JSON.parse(expectedRaw) as ExpectedFile;

  // Validate our own ground truth against the schema (catches corpus drift).
  const truthCheck = InvoiceSchema.safeParse(truth.expected);
  if (!truthCheck.success) {
    return {
      id,
      stresses: truth.stresses,
      failed: `ground-truth invalid: ${truthCheck.error.issues[0]?.message ?? "?"}`,
      fields: [],
      fieldAccuracy: 0,
      anomaly: scoreAnomalies(truth.expectedAnomalies, []),
    };
  }

  // --dry-run skips the model and "extracts" the ground truth verbatim. This
  // exercises the whole scoring + reporting pipeline (and the corpus) without
  // spending API credits — a perfect run is the expected output.
  const result = dryRun
    ? ({ ok: true, invoice: truth.expected, usage: { input: 0, output: 0 } } as const)
    : await extractInvoice(pdf.toString("base64"));
  if (!result.ok) {
    const reason =
      result.kind === "validation"
        ? `validation failed (${result.issues[0]?.path}: ${result.issues[0]?.message})`
        : result.kind === "api_error"
          ? `API error: ${result.message}`
          : result.kind;
    return {
      id,
      stresses: truth.stresses,
      failed: reason,
      fields: [],
      fieldAccuracy: 0,
      anomaly: scoreAnomalies(truth.expectedAnomalies, []),
    };
  }

  const { fields, accuracy } = scoreInvoice(truth.expected, result.invoice);
  const gotAnomalies = detectAnomalies(result.invoice).map((a) => a.code);
  const anomaly = scoreAnomalies(truth.expectedAnomalies, gotAnomalies);

  return {
    id,
    stresses: truth.stresses,
    fields,
    fieldAccuracy: accuracy,
    anomaly,
  };
}

// ── reporting ────────────────────────────────────────────────────────────────

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function colorPct(n: number): string {
  const s = pct(n).padStart(4);
  if (n >= 0.999) return c(C.green, s);
  if (n >= 0.8) return c(C.yellow, s);
  return c(C.red, s);
}

function printPerSampleTable(scores: SampleScore[]) {
  console.log(c(C.bold, "\nPer-sample results\n"));
  const idW = Math.max(12, ...scores.map((s) => s.id.length));
  const header =
    "  " +
    "sample".padEnd(idW) +
    "  fields  anomalies            notes";
  console.log(c(C.gray, header));
  console.log(c(C.gray, "  " + "─".repeat(idW + 40)));

  for (const s of scores) {
    const idCell = s.id.padEnd(idW);
    if (s.failed) {
      console.log(
        "  " + idCell + "  " + c(C.red, "FAIL".padStart(6)) + "  " + " ".repeat(20) + c(C.red, s.failed),
      );
      continue;
    }
    const { truePositives: tp, falsePositives: fp, falseNegatives: fn } = s.anomaly;
    const anomalyCell =
      tp + fp + fn === 0
        ? c(C.green, "—   ".padEnd(20))
        : `${c(C.green, `${tp}tp`)} ${fp ? c(C.red, `${fp}fp`) : c(C.gray, "0fp")} ${
            fn ? c(C.red, `${fn}fn`) : c(C.gray, "0fn")
          }`.padEnd(useColor ? 20 + 30 : 20);
    console.log(
      "  " +
        idCell +
        "  " +
        colorPct(s.fieldAccuracy) +
        "   " +
        anomalyCell +
        " " +
        c(C.dim, s.stresses),
    );
  }
}

function printFieldMatrix(scores: SampleScore[]) {
  const ran = scores.filter((s) => !s.failed);
  if (ran.length === 0) return;

  console.log(c(C.bold, "\nField-level accuracy (across samples)\n"));

  const agg = aggregateFields(ran);
  const fieldW = Math.max(...SCORED_FIELDS.map((f) => f.length));
  for (const field of SCORED_FIELDS) {
    const a = agg.get(field)!;
    const acc = a.applicable === 0 ? 1 : a.correct / a.applicable;
    const bar = makeBar(acc);
    console.log(
      "  " +
        field.padEnd(fieldW) +
        "  " +
        colorPct(acc) +
        "  " +
        bar +
        c(C.gray, `  ${a.correct}/${a.applicable}`),
    );
  }
}

function makeBar(frac: number): string {
  const width = 20;
  const filled = Math.round(frac * width);
  const color = frac >= 0.999 ? C.green : frac >= 0.8 ? C.yellow : C.red;
  return c(color, "█".repeat(filled)) + c(C.gray, "░".repeat(width - filled));
}

/** Aggregate per-field correct/applicable counts across the (non-failed) samples. */
function aggregateFields(
  ran: SampleScore[],
): Map<ScoredField, { correct: number; applicable: number }> {
  const agg = new Map<ScoredField, { correct: number; applicable: number }>();
  for (const f of SCORED_FIELDS) agg.set(f, { correct: 0, applicable: 0 });
  for (const s of ran) {
    for (const fr of s.fields) {
      if (fr.correct === null) continue;
      const a = agg.get(fr.field)!;
      a.applicable++;
      if (fr.correct) a.correct++;
    }
  }
  return agg;
}

function printSummary(scores: SampleScore[]) {
  const ran = scores.filter((s) => !s.failed);
  const failedCount = scores.length - ran.length;

  const meanFieldAcc =
    ran.length === 0
      ? 0
      : ran.reduce((a, s) => a + s.fieldAccuracy, 0) / ran.length;

  // Micro field accuracy: pool all applicable fields.
  let correct = 0;
  let applicable = 0;
  for (const s of ran) {
    for (const f of s.fields) {
      if (f.correct === null) continue;
      applicable++;
      if (f.correct) correct++;
    }
  }
  const microFieldAcc = applicable === 0 ? 0 : correct / applicable;

  const an = aggregateAnomalies(scores);

  console.log(c(C.bold, "\nSummary\n"));
  const row = (label: string, value: string) =>
    console.log("  " + label.padEnd(34) + value);

  row("Model", c(C.cyan, MODEL));
  row("Samples run", `${ran.length}${failedCount ? c(C.red, ` (+${failedCount} failed)`) : ""}`);
  row("Field accuracy (micro)", colorPct(microFieldAcc) + c(C.gray, `  ${correct}/${applicable} fields`));
  row("Field accuracy (per-sample mean)", colorPct(meanFieldAcc));
  row(
    "Anomaly precision",
    colorPct(an.precision) + c(C.gray, `  ${an.tp}tp / ${an.tp + an.fp}`),
  );
  row(
    "Anomaly recall",
    colorPct(an.recall) + c(C.gray, `  ${an.tp}tp / ${an.tp + an.fn}`),
  );
  row("Anomaly F1", colorPct(an.f1));
  console.log();
}

/**
 * Persist a machine-readable summary to eval/results.json so the landing page
 * can render it as a "proof" badge. Only called on real (non-dry-run) runs
 * with no hard failures, so the badge always reflects a complete live run.
 */
async function writeResults(scores: SampleScore[]): Promise<void> {
  const ran = scores.filter((s) => !s.failed);
  const agg = aggregateFields(ran);

  let correct = 0;
  let total = 0;
  const perField = SCORED_FIELDS.map((field) => {
    const a = agg.get(field)!;
    correct += a.correct;
    total += a.applicable;
    return {
      field,
      accuracy: a.applicable === 0 ? 1 : a.correct / a.applicable,
      correct: a.correct,
      total: a.applicable,
    };
  });

  const an = aggregateAnomalies(scores);
  const results: EvalResults = {
    model: MODEL,
    ranAt: new Date().toISOString(),
    samples: ran.length,
    fieldAccuracy: total === 0 ? 0 : correct / total,
    fieldsCorrect: correct,
    fieldsTotal: total,
    anomaly: {
      precision: an.precision,
      recall: an.recall,
      f1: an.f1,
      tp: an.tp,
      fp: an.fp,
      fn: an.fn,
    },
    perField,
  };

  await writeFile(
    join(HERE, "results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(c(C.gray, `  wrote eval/results.json (drives the landing-page badge)\n`));
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filter = args.filter((a) => !a.startsWith("--"));

  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      c(C.red, "ANTHROPIC_API_KEY is not set.") +
        " Add it to .env.local (see .env.example), then re-run `pnpm eval`." +
        c(C.gray, "\n(Tip: `pnpm eval --dry-run` validates the harness without calling the API.)"),
    );
    process.exit(1);
  }

  const ids = await discoverSamples(filter);
  if (ids.length === 0) {
    console.error(
      "No samples found. Run `pnpm eval:gen` first" +
        (filter.length ? ` (or check the names: ${filter.join(", ")}).` : "."),
    );
    process.exit(1);
  }

  console.log(
    c(C.bold, `\nAI Invoice Parser — eval`) +
      c(C.gray, `  (${ids.length} sample${ids.length === 1 ? "" : "s"}, model ${MODEL})`) +
      (dryRun ? c(C.yellow, "  [dry-run: scoring ground truth, no API calls]") : ""),
  );
  console.log(
    c(
      C.dim,
      dryRun
        ? "Stubbing extraction with ground truth to validate the harness…"
        : "Running each PDF through the live extraction pipeline…",
    ),
  );

  const scores: SampleScore[] = [];
  for (const id of ids) {
    process.stdout.write(c(C.gray, `  · ${id} … `));
    const t0 = Date.now();
    const score = await runSample(id, dryRun);
    const dt = Date.now() - t0;
    scores.push(score);
    if (score.failed) {
      process.stdout.write(c(C.red, `fail (${dt}ms)\n`));
    } else {
      process.stdout.write(
        c(C.green, `ok`) + c(C.gray, ` (${pct(score.fieldAccuracy)} fields, ${dt}ms)\n`),
      );
    }
  }

  printPerSampleTable(scores);
  printFieldMatrix(scores);
  printSummary(scores);

  const hardFailures = scores.filter((s) => s.failed).length;

  // Persist results for the landing-page badge — real runs only, and only when
  // the whole corpus ran cleanly so the badge reflects a complete result.
  if (!dryRun && hardFailures === 0) {
    await writeResults(scores);
  }

  // Exit non-zero if anything hard-failed, so CI can gate on it.
  process.exit(hardFailures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
