import type { ScoredField } from "@/eval/score";

/**
 * Shape of eval/results.json — the artifact `pnpm eval` writes on a real run
 * and the landing page renders as a "proof" badge. Kept in lib/ (not eval/) so
 * both the runner and the Next app import the same type.
 */
export interface EvalResults {
  model: string;
  /** ISO timestamp of the run. */
  ranAt: string;
  samples: number;
  /** Micro field accuracy across all applicable fields, 0..1. */
  fieldAccuracy: number;
  fieldsCorrect: number;
  fieldsTotal: number;
  anomaly: {
    precision: number;
    recall: number;
    f1: number;
    tp: number;
    fp: number;
    fn: number;
  };
  /** Per-field accuracy, for an optional detailed view. */
  perField: Array<{ field: ScoredField; accuracy: number; correct: number; total: number }>;
}

/**
 * Read eval/results.json at runtime if it exists. Returns null when the eval
 * has never been run (so the badge hides gracefully). Server-only — uses fs.
 */
export async function loadEvalResults(): Promise<EvalResults | null> {
  // Lazy/dynamic imports so this module is import-safe from anywhere; the fs
  // access only happens server-side when actually called.
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    const raw = await readFile(join(process.cwd(), "eval", "results.json"), "utf8");
    return JSON.parse(raw) as EvalResults;
  } catch {
    return null;
  }
}
