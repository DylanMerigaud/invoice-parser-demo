/**
 * Generates the eval corpus: one PDF + one expected.json per sample, plus a
 * copy of the landing-page subset into /public/samples.
 *
 *   pnpm eval:gen
 *
 * Re-run any time you change eval/samples.ts. The PDFs are committed so the
 * demo and the eval run without a generation step, but this keeps them
 * reproducible from the declarative definitions.
 */

import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SAMPLES } from "./samples";
import { renderInvoicePdf } from "./render";

const execFileP = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SAMPLES_DIR = join(HERE, "samples");
const PUBLIC_SAMPLES_DIR = join(ROOT, "public", "samples");
const PREVIEWS_DIR = join(PUBLIC_SAMPLES_DIR, "previews");

/** True if `pdftoppm` (poppler) is on PATH — used to render preview thumbnails. */
async function hasPdftoppm(): Promise<boolean> {
  try {
    await execFileP("pdftoppm", ["-v"]);
    return true;
  } catch {
    return false;
  }
}

/** Render a first-page PNG thumbnail of a PDF into public/samples/previews/. */
async function renderPreview(id: string, pdfPath: string): Promise<void> {
  await execFileP("pdftoppm", [
    "-png",
    "-r", "70",
    "-f", "1", "-l", "1",
    "-singlefile",
    pdfPath,
    join(PREVIEWS_DIR, id),
  ]);
}

async function main() {
  await mkdir(SAMPLES_DIR, { recursive: true });
  await mkdir(PUBLIC_SAMPLES_DIR, { recursive: true });
  await mkdir(PREVIEWS_DIR, { recursive: true });

  // Preview thumbnails need poppler's pdftoppm. They're committed assets, so a
  // missing binary just skips regeneration (with a warning) rather than failing.
  const canPreview = await hasPdftoppm();
  if (!canPreview) {
    console.warn(
      "  ! pdftoppm (poppler) not found — skipping preview thumbnails " +
        "(install poppler to regenerate them; committed PNGs are used otherwise).\n",
    );
  }

  console.log(`Generating ${SAMPLES.length} sample invoices…\n`);

  for (const sample of SAMPLES) {
    const pdf = await renderInvoicePdf(sample.expected, sample.style);
    const pdfPath = join(SAMPLES_DIR, `${sample.id}.pdf`);
    await writeFile(pdfPath, pdf);

    // Ground-truth file: the expected extraction + expected anomaly codes.
    const expectedPath = join(SAMPLES_DIR, `${sample.id}.expected.json`);
    await writeFile(
      expectedPath,
      JSON.stringify(
        {
          stresses: sample.stresses,
          expected: sample.expected,
          expectedAnomalies: sample.expectedAnomalies,
        },
        null,
        2,
      ) + "\n",
    );

    // Copy landing samples into /public so the UI can fetch them, plus a
    // first-page PNG thumbnail for the hover preview popover.
    if (sample.landing) {
      const publicPdf = join(PUBLIC_SAMPLES_DIR, `${sample.id}.pdf`);
      await copyFile(pdfPath, publicPdf);
      if (canPreview) await renderPreview(sample.id, publicPdf);
    }

    console.log(
      `  ✓ ${sample.id.padEnd(20)} ${(pdf.length / 1024).toFixed(0).padStart(4)} KB  ${
        sample.landing ? `(+ landing${canPreview ? " + preview" : ""})` : ""
      }`,
    );
  }

  console.log(`\nWrote PDFs + ground truth to eval/samples/`);
  console.log(`Copied landing subset to public/samples/`);
  if (canPreview) console.log(`Rendered preview thumbnails to public/samples/previews/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
