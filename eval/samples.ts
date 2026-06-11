/**
 * Declarative definitions of the eval corpus. Each sample is an invoice
 * rendered to PDF in a deliberately *different* way to stress the parser:
 * different layouts, number formats, languages, page counts, and a couple with
 * intentional defects. This is a SYNTHETIC adversarial set — see README. The
 * point isn't photorealism, it's format diversity + known ground truth.
 *
 * `expected` is the ground-truth extraction (what a correct parse should
 * return). `expectedAnomalies` is the set of anomaly codes that SHOULD fire on
 * the correctly-extracted data — that's what the harness scores precision/
 * recall against.
 */

import type { Invoice } from "@/lib/schema";
import type { AnomalyCode } from "@/lib/anomalies";

export type Locale = "en" | "de" | "he";

/** Visual style knobs handed to the renderer. */
export interface RenderStyle {
  /** "1.234,56" (European) vs "1,234.56" (US) number rendering on the PDF. */
  numberFormat: "us" | "eu";
  /** Currency symbol drawn on the page (display only; data uses ISO code). */
  symbol: string;
  /** Labels language. */
  locale: Locale;
  /** Force the line items across multiple pages. */
  multiPage?: boolean;
  /** Render as a low-contrast, slightly rotated "scan". */
  scanned?: boolean;
  /** Accent color for the header band, as [r,g,b] 0-1. */
  accent?: [number, number, number];
  /** Font family family for the body. */
  font?: "helvetica" | "times" | "courier";
}

export interface SampleDef {
  id: string;
  /** One-line description of what this sample stresses (printed in eval table). */
  stresses: string;
  /** Included as a "try an example" button on the landing page. */
  landing?: boolean;
  style: RenderStyle;
  /** Ground-truth extraction. */
  expected: Invoice;
  /** Anomaly codes that should fire on the correct extraction. */
  expectedAnomalies: AnomalyCode[];
}

export const SAMPLES: SampleDef[] = [
  // 1. Clean baseline — everything reconciles.
  {
    id: "clean-acme",
    stresses: "Clean, well-structured invoice (baseline)",
    landing: true,
    style: { numberFormat: "us", symbol: "$", locale: "en", accent: [0.31, 0.27, 0.9] },
    expected: {
      vendor: {
        name: "Acme Industrial Supply",
        address: "1200 Market Street, San Francisco, CA 94103",
        taxId: "US-94-2233445",
      },
      invoiceNumber: "ACM-2024-0481",
      issueDate: "2024-03-04",
      dueDate: "2024-04-03",
      currency: "USD",
      lineItems: [
        { description: "Hex bolts M8x40 (box of 100)", qty: 12, unitPrice: 14.5, amount: 174 },
        { description: "Stainless washers (box of 200)", qty: 8, unitPrice: 9.75, amount: 78 },
        { description: "Threadlocker 243, 50ml", qty: 6, unitPrice: 11.2, amount: 67.2 },
        { description: "Shipping & handling", qty: 1, unitPrice: 32.4, amount: 32.4 },
      ],
      subtotal: 351.6,
      tax: 28.13,
      total: 379.73,
    },
    expectedAnomalies: [],
  },

  // 2. Multi-currency with European number formatting and € symbol.
  {
    id: "multicurrency-eur",
    stresses: "EUR currency, European number format (1.234,56)",
    landing: true,
    style: { numberFormat: "eu", symbol: "€", locale: "en", accent: [0.02, 0.5, 0.45], font: "times" },
    expected: {
      vendor: {
        name: "Nordlicht Components GmbH",
        address: "Hafenstraße 18, 20095 Hamburg, Germany",
        taxId: "DE811223344",
      },
      invoiceNumber: "NL-9931",
      issueDate: "2024-02-12",
      dueDate: "2024-03-13",
      currency: "EUR",
      lineItems: [
        { description: "Aluminium profile 40x40, 2m", qty: 25, unitPrice: 18.9, amount: 472.5 },
        { description: "Corner brackets, zinc", qty: 100, unitPrice: 1.45, amount: 145 },
        { description: "Assembly service (hours)", qty: 6, unitPrice: 65, amount: 390 },
      ],
      subtotal: 1007.5,
      tax: 191.43,
      total: 1198.93,
    },
    expectedAnomalies: [],
  },

  // 3. Intentional math error — line items don't sum to the printed subtotal.
  {
    id: "math-error",
    stresses: "Deliberate math error (line items ≠ subtotal)",
    landing: true,
    style: { numberFormat: "us", symbol: "$", locale: "en", accent: [0.72, 0.22, 0.22] },
    expected: {
      vendor: {
        name: "Brightpath Marketing LLC",
        address: "55 W 21st St, New York, NY 10010",
        taxId: "US-88-7766554",
      },
      invoiceNumber: "BP-1042",
      issueDate: "2024-01-22",
      dueDate: "2024-02-21",
      currency: "USD",
      // Lines sum to 4200.00, but the invoice prints subtotal 4000.00 — a real
      // transcription of a wrong invoice. The checker should flag it.
      lineItems: [
        { description: "Landing page design", qty: 1, unitPrice: 2500, amount: 2500 },
        { description: "Copywriting (per page)", qty: 5, unitPrice: 200, amount: 1000 },
        { description: "Stock photography license", qty: 1, unitPrice: 700, amount: 700 },
      ],
      subtotal: 4000,
      tax: 320,
      total: 4320,
    },
    // Lines (4200) ≠ subtotal (4000): line_items_sum_mismatch.
    // subtotal(4000)+tax(320)=4320=total: totals OK. tax rate 8% OK.
    expectedAnomalies: ["line_items_sum_mismatch"],
  },

  // 4. Missing optional fields — no address, no taxId, no dueDate, no tax.
  {
    id: "missing-fields",
    stresses: "Missing optional fields (no tax, due date, or address)",
    style: { numberFormat: "us", symbol: "$", locale: "en", accent: [0.3, 0.3, 0.33], font: "courier" },
    expected: {
      vendor: { name: "J. Okafor Photography", address: null, taxId: null },
      invoiceNumber: "2024-017",
      issueDate: "2024-05-09",
      dueDate: null,
      currency: "USD",
      lineItems: [
        { description: "Event coverage, half day", qty: 1, unitPrice: 650, amount: 650 },
        { description: "Edited photos (delivery)", qty: 1, unitPrice: 150, amount: 150 },
      ],
      subtotal: 800,
      tax: null,
      total: 800,
    },
    expectedAnomalies: [],
  },

  // 5. Non-English (German) labels with EUR.
  {
    id: "non-english-de",
    stresses: "German-language invoice (Rechnung, MwSt.)",
    landing: true,
    style: { numberFormat: "eu", symbol: "€", locale: "de", accent: [0.12, 0.32, 0.6] },
    expected: {
      vendor: {
        name: "Becker Bürotechnik",
        address: "Lindenallee 7, 50667 Köln",
        taxId: "DE246802468",
      },
      invoiceNumber: "RG-2024-0334",
      issueDate: "2024-04-18",
      dueDate: "2024-05-02",
      currency: "EUR",
      lineItems: [
        { description: "Bürostuhl ergonomisch", qty: 4, unitPrice: 189.9, amount: 759.6 },
        { description: "Schreibtischlampe LED", qty: 4, unitPrice: 39.5, amount: 158 },
        { description: "Lieferung", qty: 1, unitPrice: 25, amount: 25 },
      ],
      subtotal: 942.6,
      tax: 179.09,
      total: 1121.69,
    },
    expectedAnomalies: [],
  },

  // 6. Multi-page: enough line items to spill onto a second page.
  {
    id: "multipage",
    stresses: "Multi-page invoice (line items span 2 pages)",
    style: { numberFormat: "us", symbol: "$", locale: "en", multiPage: true, accent: [0.31, 0.27, 0.9] },
    expected: {
      vendor: {
        name: "Cascade Wholesale Foods",
        address: "4400 NW Yeon Ave, Portland, OR 97210",
        taxId: "US-93-1122334",
      },
      invoiceNumber: "CWF-77120",
      issueDate: "2024-03-28",
      dueDate: "2024-04-27",
      currency: "USD",
      lineItems: [
        { description: "Organic flour, 25kg sack", qty: 20, unitPrice: 34.0, amount: 680 },
        { description: "Cane sugar, 25kg sack", qty: 15, unitPrice: 28.5, amount: 427.5 },
        { description: "Olive oil, 5L tin", qty: 24, unitPrice: 41.25, amount: 990 },
        { description: "Sea salt, 10kg bag", qty: 30, unitPrice: 12.8, amount: 384 },
        { description: "Black peppercorns, 5kg", qty: 8, unitPrice: 64.5, amount: 516 },
        { description: "Canned tomatoes, case of 12", qty: 40, unitPrice: 18.9, amount: 756 },
        { description: "Dried pasta, 10kg box", qty: 22, unitPrice: 26.4, amount: 580.8 },
        { description: "Yeast, 1kg vacuum pack", qty: 18, unitPrice: 9.95, amount: 179.1 },
        { description: "Baking soda, 5kg", qty: 12, unitPrice: 7.5, amount: 90 },
        { description: "Vanilla extract, 1L", qty: 6, unitPrice: 58.0, amount: 348 },
        { description: "Cocoa powder, 5kg", qty: 9, unitPrice: 44.2, amount: 397.8 },
        { description: "Delivery surcharge", qty: 1, unitPrice: 120, amount: 120 },
      ],
      subtotal: 5469.2,
      tax: 437.54,
      total: 5906.74,
    },
    expectedAnomalies: [],
  },

  // 7. Scanned-look: low-contrast, rotated render.
  {
    id: "scanned-look",
    stresses: "Scanned/skewed low-contrast render",
    style: { numberFormat: "us", symbol: "$", locale: "en", scanned: true, accent: [0.25, 0.25, 0.25], font: "times" },
    expected: {
      vendor: {
        name: "Riverside Auto Parts",
        address: "812 Industrial Rd, Cleveland, OH 44109",
        taxId: "US-34-5566778",
      },
      invoiceNumber: "RAP-5589",
      issueDate: "2024-02-29",
      dueDate: "2024-03-30",
      currency: "USD",
      lineItems: [
        { description: "Brake pads, ceramic (set)", qty: 4, unitPrice: 48.0, amount: 192 },
        { description: "Oil filter", qty: 10, unitPrice: 7.25, amount: 72.5 },
        { description: "Synthetic oil, 5qt", qty: 6, unitPrice: 31.99, amount: 191.94 },
        { description: "Labor", qty: 3, unitPrice: 95, amount: 285 },
      ],
      subtotal: 741.44,
      tax: 59.32,
      total: 800.76,
    },
    expectedAnomalies: [],
  },

  // 8. Duplicate line items.
  {
    id: "duplicate-lines",
    stresses: "Duplicate line items (possible double charge)",
    style: { numberFormat: "us", symbol: "$", locale: "en", accent: [0.6, 0.4, 0.05] },
    expected: {
      vendor: {
        name: "Summit Cloud Services",
        address: "500 Tech Pkwy, Austin, TX 78701",
        taxId: "US-45-9988776",
      },
      invoiceNumber: "SCS-30277",
      issueDate: "2024-04-01",
      dueDate: "2024-04-15",
      currency: "USD",
      lineItems: [
        { description: "Compute instance (monthly)", qty: 1, unitPrice: 420, amount: 420 },
        { description: "Object storage (TB)", qty: 5, unitPrice: 23, amount: 115 },
        // Same as the first line — a duplicated charge.
        { description: "Compute instance (monthly)", qty: 1, unitPrice: 420, amount: 420 },
        { description: "Support plan", qty: 1, unitPrice: 99, amount: 99 },
      ],
      subtotal: 1054,
      tax: 86.96,
      total: 1140.96,
    },
    expectedAnomalies: ["duplicate_line_items"],
  },

  // 9. Hebrew (right-to-left, non-Latin script) with ILS. Stresses RTL layout +
  //    a Unicode-only script the standard PDF fonts can't render. Amounts use
  //    Latin digits (as real Israeli invoices do); labels/text are Hebrew.
  {
    id: "non-english-he",
    stresses: "Hebrew RTL invoice (ILS, non-Latin script)",
    landing: true,
    style: { numberFormat: "us", symbol: "ILS", locale: "he", accent: [0.1, 0.32, 0.55] },
    expected: {
      vendor: {
        name: "מזרחי טכנולוגיות בע״מ", // gershayim (U+05F4) for "Ltd", not ASCII quote
        // Address kept free of Latin digits so it renders as a clean RTL run;
        // the house number is written in Hebrew letters' stead by omitting it.
        address: "רחוב הברזל, תל אביב",
        taxId: "51-432198-7",
      },
      invoiceNumber: "2024-5567",
      issueDate: "2024-05-14",
      dueDate: "2024-06-13",
      currency: "ILS",
      lineItems: [
        // Hebrew descriptions kept free of ASCII punctuation — Noto Sans Hebrew
        // covers Hebrew letters only, so "(" / ")" would render as tofu.
        { description: "שעות פיתוח תוכנה", qty: 40, unitPrice: 45, amount: 1800 },
        { description: "אחסון בענן חודשי", qty: 1, unitPrice: 1200, amount: 1200 },
        { description: "תמיכה טכנית", qty: 1, unitPrice: 450, amount: 450 },
      ],
      subtotal: 3450,
      tax: 586.5, // 17% Israeli VAT
      total: 4036.5,
    },
    expectedAnomalies: [],
  },
];
