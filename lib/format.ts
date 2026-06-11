/** Display helpers for the results UI. Presentation-only; no business logic. */

/**
 * Format a number as money in the invoice's currency. Falls back to a plain
 * grouped number if the currency code isn't one `Intl` recognizes.
 */
export function formatMoney(
  value: number,
  currency: string | null | undefined,
): string {
  if (currency && /^[A-Za-z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency.toUpperCase(),
        currencyDisplay: "narrowSymbol",
      }).format(value);
    } catch {
      // Unknown currency code — fall through to plain formatting.
    }
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Format a plain number (qty) without forcing decimals. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(value);
}

/** Render an ISO date (YYYY-MM-DD) as e.g. "Mar 15, 2024". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  // Use UTC so a date-only string doesn't shift across timezones.
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
