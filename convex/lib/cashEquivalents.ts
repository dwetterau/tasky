/**
 * Money market funds brokerages use as settlement or sweep funds. They hold a
 * stable $1 share price, so the portfolio views fold them into cash (the empty
 * ticker) instead of listing them as separate holdings.
 */
const CASH_EQUIVALENT_TICKERS = new Set([
  // Vanguard
  "VMFXX",
  "VMRXX",
  "VUSXX",
  "VMSXX",
  // Fidelity
  "SPAXX",
  "FDRXX",
  "FZFXX",
  "FCASH",
  "SPRXX",
  "FDLXX",
  "FZDXX",
  // Schwab
  "SWVXX",
  "SNVXX",
  "SNSXX",
  "SNOXX",
  "SNAXX",
]);

export function isCashEquivalentTicker(ticker: string): boolean {
  return CASH_EQUIVALENT_TICKERS.has(ticker.trim().toUpperCase());
}

/** The ticker to group and display a holding under; cash is the empty string. */
export function displayTicker(ticker: string): string {
  const normalized = ticker.trim().toUpperCase();
  return CASH_EQUIVALENT_TICKERS.has(normalized) ? "" : normalized;
}
