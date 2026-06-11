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
import { SAMPLES } from "./samples";
import { renderInvoicePdf } from "./render";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SAMPLES_DIR = join(HERE, "samples");
const PUBLIC_SAMPLES_DIR = join(ROOT, "public", "samples");

async function main() {
  await mkdir(SAMPLES_DIR, { recursive: true });
  await mkdir(PUBLIC_SAMPLES_DIR, { recursive: true });

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

    // Copy landing samples into /public so the UI can fetch them.
    if (sample.landing) {
      await copyFile(pdfPath, join(PUBLIC_SAMPLES_DIR, `${sample.id}.pdf`));
    }

    console.log(
      `  ✓ ${sample.id.padEnd(20)} ${(pdf.length / 1024).toFixed(0).padStart(4)} KB  ${
        sample.landing ? "(+ landing)" : ""
      }`,
    );
  }

  console.log(`\nWrote PDFs + ground truth to eval/samples/`);
  console.log(`Copied landing subset to public/samples/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
