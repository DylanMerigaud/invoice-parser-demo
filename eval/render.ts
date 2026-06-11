/**
 * A tiny invoice-layout engine over pdf-lib. Given a ground-truth Invoice and a
 * RenderStyle, it draws a realistic-enough invoice PDF. It deliberately varies
 * layout, number formatting, language, page count, and contrast so the eval
 * corpus stresses real format diversity.
 *
 * Note: this renders the data AS PRINTED. For the `math-error` sample the
 * printed subtotal differs from the line sum on purpose — we draw exactly what
 * the ground truth says, defects included.
 */

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
  type RGB,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Invoice } from "@/lib/schema";
import type { RenderStyle, Locale } from "./samples";

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const MARGIN = 50;

interface Labels {
  invoice: string;
  billedTo: string;
  invoiceNo: string;
  issued: string;
  due: string;
  taxId: string;
  description: string;
  qty: string;
  unitPrice: string;
  amount: string;
  subtotal: string;
  tax: string;
  total: string;
  page: string;
}

const LABELS: Record<Locale, Labels> = {
  en: {
    invoice: "INVOICE",
    billedTo: "Billed to",
    invoiceNo: "Invoice No.",
    issued: "Issue date",
    due: "Due date",
    taxId: "Tax ID",
    description: "Description",
    qty: "Qty",
    unitPrice: "Unit price",
    amount: "Amount",
    subtotal: "Subtotal",
    tax: "Tax",
    total: "Total",
    page: "Page",
  },
  de: {
    invoice: "RECHNUNG",
    billedTo: "Rechnung an",
    invoiceNo: "Rechnungsnr.",
    issued: "Rechnungsdatum",
    due: "Fällig am",
    taxId: "USt-IdNr.",
    description: "Beschreibung",
    qty: "Menge",
    unitPrice: "Einzelpreis",
    amount: "Betrag",
    subtotal: "Zwischensumme",
    tax: "MwSt.",
    total: "Gesamt",
    page: "Seite",
  },
  he: {
    invoice: "חשבונית מס",
    billedTo: "לקוח",
    invoiceNo: "מס׳ חשבונית",
    issued: "תאריך הוצאה",
    due: "לתשלום עד",
    taxId: "ח״פ", // company-number label; gershayim (Noto has it), not ASCII dots

    description: "תיאור",
    qty: "כמות",
    unitPrice: "מחיר ליחידה",
    amount: "סכום",
    subtotal: "סכום ביניים",
    tax: "מע״מ", // gershayim (U+05F4), not ASCII quote — the Hebrew font has it
    total: "סה״כ",
    page: "עמוד",
  },
};

/** Format a number the way the PDF should *display* it (US vs EU separators). */
function fmt(n: number, style: RenderStyle): string {
  const fixed = n.toFixed(2);
  const [intPart, dec] = fixed.split(".");
  const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, style.numberFormat === "eu" ? "." : ",");
  const sep = style.numberFormat === "eu" ? "," : ".";
  return `${grouped}${sep}${dec}`;
}

function money(n: number, style: RenderStyle): string {
  // Multi-character symbols (e.g. an ISO code like "ILS") read as a trailing,
  // space-separated suffix. Single glyphs ($, €) follow the locale convention:
  // EU = amount then symbol, US = symbol then amount.
  if (style.symbol.length > 1) {
    return `${fmt(n, style)} ${style.symbol}`;
  }
  return style.numberFormat === "eu"
    ? `${fmt(n, style)} ${style.symbol}`
    : `${style.symbol}${fmt(n, style)}`;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  /** Hebrew (Noto) pair, embedded only for the `he` locale. */
  hebRegular?: PDFFont;
  hebBold?: PDFFont;
}

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "fonts");

async function loadFonts(doc: PDFDocument, style: RenderStyle): Promise<Fonts> {
  const family = style.font ?? "helvetica";
  const map = {
    helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
    times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
    courier: [StandardFonts.Courier, StandardFonts.CourierBold],
  } as const;
  const [reg, bold] = map[family];
  const fonts: Fonts = {
    regular: await doc.embedFont(reg),
    bold: await doc.embedFont(bold),
  };

  // Standard PDF fonts are WinAnsi-encoded and cannot render Hebrew, so embed a
  // Unicode TTF (Noto Sans Hebrew, OFL — committed in eval/fonts/). fontkit must
  // be registered before embedding a custom font.
  if (style.locale === "he") {
    doc.registerFontkit(fontkit);
    fonts.hebRegular = await doc.embedFont(
      readFileSync(join(FONT_DIR, "NotoSansHebrew-Regular.ttf")),
      { subset: true },
    );
    fonts.hebBold = await doc.embedFont(
      readFileSync(join(FONT_DIR, "NotoSansHebrew-Bold.ttf")),
      { subset: true },
    );
  }
  return fonts;
}

const HEBREW_RE = /[֐-׿]/;

/** True if the string contains any Hebrew character. */
function hasHebrew(s: string): boolean {
  return HEBREW_RE.test(s);
}

/**
 * Pick the right font for a string: the Hebrew TTF (Noto) when the text
 * contains Hebrew, otherwise the Latin font passed in.
 *
 * Noto Sans Hebrew covers ONLY Hebrew letters/punctuation — no Latin digits or
 * ASCII. So this is a clean per-string split: Hebrew labels/descriptions go to
 * Noto; amounts/dates/codes stay in the Latin font (and the sample renders the
 * shekel as the text "ILS" rather than the ₪ glyph, which WinAnsi can't encode,
 * to avoid mixed-font runs within one string).
 */
function fontFor(s: string, latin: PDFFont, fonts: Fonts, bold: boolean): PDFFont {
  if (hasHebrew(s) && fonts.hebRegular && fonts.hebBold) {
    return bold ? fonts.hebBold : fonts.hebRegular;
  }
  return latin;
}

/**
 * Draw a (possibly Hebrew) string at a left x, auto-selecting the font. Text is
 * passed in logical order; pdf-lib + the embedded Hebrew TTF render RTL natively
 * (no manual reordering — reordering double-processes and corrupts the glyphs).
 * RTL alignment is handled by the right-aligned variants below.
 */
function drawT(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  latin: PDFFont,
  fonts: Fonts,
  color: RGB,
  bold = false,
): void {
  const font = fontFor(text, latin, fonts, bold);
  page.drawText(text, { x, y, size, font, color });
}

/** Right-aligned variant of drawT (measures the string in its selected font). */
function drawTRight(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  size: number,
  latin: PDFFont,
  fonts: Fonts,
  color: RGB,
  bold = false,
): void {
  const font = fontFor(text, latin, fonts, bold);
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - w, y, size, font, color });
}

/** Render one Invoice to a PDF and return the bytes. */
export async function renderInvoicePdf(
  invoice: Invoice,
  style: RenderStyle,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await loadFonts(doc, style);
  const labels = LABELS[style.locale];
  const accent = rgb(...(style.accent ?? [0.31, 0.27, 0.9]));

  // Color palette: a "scanned" doc is washed-out grayscale.
  const inkColor = style.scanned ? rgb(0.25, 0.25, 0.27) : rgb(0.07, 0.07, 0.09);
  const mutedColor = style.scanned ? rgb(0.45, 0.45, 0.47) : rgb(0.42, 0.42, 0.47);
  const lineColor = rgb(0.85, 0.85, 0.87);

  // How many line items fit per page (first page has the header, so fewer).
  const ROWS_FIRST = style.multiPage ? 8 : 100;
  const ROWS_REST = 22;

  const ctx: DrawCtx = {
    doc,
    fonts,
    style,
    labels,
    accent,
    inkColor,
    mutedColor,
    lineColor,
    pageIndex: 0,
    pages: [],
  };

  // Chunk line items across pages.
  const chunks: (typeof invoice.lineItems)[] = [];
  let remaining = invoice.lineItems.slice();
  chunks.push(remaining.slice(0, ROWS_FIRST));
  remaining = remaining.slice(ROWS_FIRST);
  while (remaining.length) {
    chunks.push(remaining.slice(0, ROWS_REST));
    remaining = remaining.slice(ROWS_REST);
  }

  for (let i = 0; i < chunks.length; i++) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    ctx.pages.push(page);
    ctx.pageIndex = i;

    // For a "scanned" look, tint the page off-white and speckle it before any
    // text is drawn, so the content sits on a degraded background.
    if (style.scanned) {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: PAGE_W,
        height: PAGE_H,
        color: rgb(0.96, 0.955, 0.93),
      });
      drawSpeckles(page, i);
    }

    let y = PAGE_H - MARGIN;

    if (i === 0) {
      y = drawHeader(ctx, page, invoice, y);
      y = drawParties(ctx, page, invoice, y);
      y -= 18;
    } else {
      y = drawContinuationHeader(ctx, page, invoice, y);
    }

    y = drawTableHeader(ctx, page, y);
    y = drawRows(ctx, page, chunks[i]!, y);

    // Totals only on the last page.
    if (i === chunks.length - 1) {
      drawTotals(ctx, page, invoice, y);
    }
  }

  // Page numbers + footer on every page (multi-page only, to avoid clutter).
  if (chunks.length > 1) {
    ctx.pages.forEach((page, i) => {
      page.drawText(`${labels.page} ${i + 1} / ${chunks.length}`, {
        x: PAGE_W - MARGIN - 70,
        y: MARGIN - 18,
        size: 8,
        font: fonts.regular,
        color: mutedColor,
      });
    });
  }

  return doc.save();
}

interface DrawCtx {
  doc: PDFDocument;
  fonts: Fonts;
  style: RenderStyle;
  labels: Labels;
  accent: RGB;
  inkColor: RGB;
  mutedColor: RGB;
  lineColor: RGB;
  pageIndex: number;
  pages: PDFPage[];
}

// Column x-positions for the line-items table.
const COL_DESC = MARGIN;
const COL_QTY = 360;
const COL_UNIT = 410;
const COL_AMT_RIGHT = PAGE_W - MARGIN; // right-aligned

function drawHeader(
  ctx: DrawCtx,
  page: PDFPage,
  invoice: Invoice,
  y: number,
): number {
  const { fonts, accent, inkColor, mutedColor, labels } = ctx;

  // Accent band title.
  drawT(page, labels.invoice, MARGIN, y - 22, 26, fonts.bold, fonts, accent, true);

  // Vendor name (right-aligned, top right).
  drawTRight(page, invoice.vendor.name, PAGE_W - MARGIN, y - 6, 13, fonts.bold, fonts, inkColor, true);
  if (invoice.vendor.address) {
    drawWrapped(page, invoice.vendor.address, {
      x: PAGE_W - MARGIN - 200,
      y: y - 22,
      width: 200,
      size: 8.5,
      font: fonts.regular,
      color: mutedColor,
      lineHeight: 11,
      align: "right",
      fonts,
    });
  }

  return y - 56;
}

function drawParties(
  ctx: DrawCtx,
  page: PDFPage,
  invoice: Invoice,
  y: number,
): number {
  const { fonts, inkColor, mutedColor, labels, accent, style } = ctx;

  // Meta block (right): invoice no, dates.
  const metaX = 360;
  let my = y;
  const metaRow = (label: string, value: string) => {
    drawT(page, label.toUpperCase(), metaX, my, 7.5, fonts.bold, fonts, mutedColor, true);
    // Values (invoice no, dates) are Latin and stay in the Latin font.
    drawT(page, value, metaX, my - 11, 10, fonts.regular, fonts, inkColor);
    my -= 28;
  };
  metaRow(labels.invoiceNo, invoice.invoiceNumber);
  metaRow(labels.issued, invoice.issueDate);
  if (invoice.dueDate) metaRow(labels.due, invoice.dueDate);

  // Vendor tax id. The label may be Hebrew (Noto) while the separator + id are
  // Latin — draw them as two runs so ASCII punctuation ("ID:") never hits the
  // Hebrew font (which has no ASCII glyphs).
  if (invoice.vendor.taxId) {
    const label = labels.taxId;
    const labelFont = fontFor(label, fonts.regular, fonts, false);
    drawT(page, label, MARGIN, y, 8.5, fonts.regular, fonts, mutedColor);
    const labelW = labelFont.widthOfTextAtSize(label, 8.5);
    // Separator + id, always in the Latin font.
    page.drawText(`: ${invoice.vendor.taxId}`, {
      x: MARGIN + labelW,
      y,
      size: 8.5,
      font: fonts.regular,
      color: mutedColor,
    });
  }

  // A thin accent rule under the header zone.
  const ruleY = Math.min(my, y - 36) - 4;
  page.drawRectangle({
    x: MARGIN,
    y: ruleY,
    width: PAGE_W - 2 * MARGIN,
    height: 1.5,
    color: accent,
    opacity: style.scanned ? 0.5 : 1,
  });

  return ruleY - 8;
}

function drawContinuationHeader(
  ctx: DrawCtx,
  page: PDFPage,
  invoice: Invoice,
  y: number,
): number {
  const { fonts, mutedColor, labels } = ctx;
  page.drawText(
    `${labels.invoice} ${invoice.invoiceNumber} (cont.)`,
    { x: MARGIN, y: y - 10, size: 11, font: fonts.bold, color: mutedColor },
  );
  return y - 34;
}

function drawTableHeader(ctx: DrawCtx, page: PDFPage, y: number): number {
  const { fonts, mutedColor, lineColor, labels } = ctx;
  drawT(page, labels.description, COL_DESC, y, 8, fonts.bold, fonts, mutedColor, true);
  drawRight(page, labels.qty, COL_QTY + 30, y, 8, fonts.bold, mutedColor, fonts);
  drawRight(page, labels.unitPrice, COL_UNIT + 60, y, 8, fonts.bold, mutedColor, fonts);
  drawRight(page, labels.amount, COL_AMT_RIGHT, y, 8, fonts.bold, mutedColor, fonts);
  const ruleY = y - 6;
  page.drawLine({
    start: { x: MARGIN, y: ruleY },
    end: { x: PAGE_W - MARGIN, y: ruleY },
    thickness: 1,
    color: lineColor,
  });
  return ruleY - 16;
}

function drawRows(
  ctx: DrawCtx,
  page: PDFPage,
  rows: Invoice["lineItems"],
  y: number,
): number {
  const { fonts, inkColor, mutedColor, lineColor, style } = ctx;
  let cy = y;
  for (const li of rows) {
    drawT(page, li.description, COL_DESC, cy, 9.5, fonts.regular, fonts, inkColor);
    drawRight(page, fmt(li.qty, { ...style, numberFormat: "us" }).replace(/\.00$/, ""), COL_QTY + 30, cy, 9.5, fonts.regular, mutedColor, fonts);
    drawRight(page, money(li.unitPrice, style), COL_UNIT + 60, cy, 9.5, fonts.regular, mutedColor, fonts);
    drawRight(page, money(li.amount, style), COL_AMT_RIGHT, cy, 9.5, fonts.regular, inkColor, fonts);
    cy -= 14;
    page.drawLine({
      start: { x: MARGIN, y: cy + 4 },
      end: { x: PAGE_W - MARGIN, y: cy + 4 },
      thickness: 0.4,
      color: lineColor,
      opacity: 0.6,
    });
    cy -= 4;
  }
  return cy;
}

function drawTotals(
  ctx: DrawCtx,
  page: PDFPage,
  invoice: Invoice,
  y: number,
): void {
  const { fonts, inkColor, mutedColor, accent, labels, style } = ctx;
  let ty = y - 12;
  const labelRight = COL_UNIT + 60;

  const row = (label: string, value: string, bold = false) => {
    drawRight(page, label, labelRight, ty, bold ? 11 : 9.5, bold ? fonts.bold : fonts.regular, bold ? inkColor : mutedColor, fonts);
    // Values are amounts; pass `fonts` so a shekel sign (₪) routes to the
    // Unicode font (Latin-only amounts still render in the Latin font).
    drawRight(page, value, COL_AMT_RIGHT, ty, bold ? 12 : 9.5, bold ? fonts.bold : fonts.regular, inkColor, fonts);
    ty -= bold ? 20 : 16;
  };

  row(labels.subtotal, money(invoice.subtotal, style));
  if (invoice.tax != null) row(labels.tax, money(invoice.tax, style));

  // Accent underline above the grand total.
  page.drawLine({
    start: { x: labelRight - 60, y: ty + 6 },
    end: { x: COL_AMT_RIGHT, y: ty + 6 },
    thickness: 1,
    color: accent,
    opacity: style.scanned ? 0.5 : 1,
  });
  ty -= 6;
  row(labels.total, money(invoice.total, style), true);
}

// ── small drawing helpers ──────────────────────────────────────────────────

/**
 * Deterministic faint speckles to fake scanner noise. Seeded by page index so
 * regeneration is reproducible (committed PDFs don't churn on every run).
 */
function drawSpeckles(page: PDFPage, seed: number): void {
  let s = (seed + 1) * 9973;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const count = 260;
  for (let i = 0; i < count; i++) {
    const x = rand() * PAGE_W;
    const y = rand() * PAGE_H;
    const r = 0.2 + rand() * 0.6;
    const g = 0.55 + rand() * 0.25;
    page.drawCircle({ x, y, size: r, color: rgb(g, g, g - 0.05), opacity: 0.35 });
  }
}

function drawRight(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  size: number,
  font: PDFFont,
  color: RGB,
  fonts?: Fonts,
): void {
  const f = fonts ? fontFor(text, font, fonts, font === fonts.bold) : font;
  const w = f.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - w, y, size, font: f, color });
}

function drawWrapped(
  page: PDFPage,
  text: string,
  opts: {
    x: number;
    y: number;
    width: number;
    size: number;
    font: PDFFont;
    color: RGB;
    lineHeight: number;
    align?: "left" | "right";
    /** When provided, Hebrew lines are shaped and drawn in the Hebrew font. */
    fonts?: Fonts;
  },
): number {
  // Wrap by splitting on comma+space (addresses are "street, city, country").
  const segments = text.split(", ");
  const lines: string[] = segments.length > 1 ? segments : [text];

  let cy = opts.y;
  for (const line of lines) {
    const font = opts.fonts ? fontFor(line, opts.font, opts.fonts, false) : opts.font;
    if (opts.align === "right") {
      const w = font.widthOfTextAtSize(line, opts.size);
      page.drawText(line, { x: opts.x + opts.width - w, y: cy, size: opts.size, font, color: opts.color });
    } else {
      page.drawText(line, { x: opts.x, y: cy, size: opts.size, font, color: opts.color });
    }
    cy -= opts.lineHeight;
  }
  return cy;
}
