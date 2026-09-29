import {
  portfolioPayloadSchema,
  type PortfolioPayload,
} from "@tasky/home-feed";
import { escapeHtml as e, sourceTime } from "../../rendering/html";
import type { HomeModule } from "../contract";
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
const signedMoney = (value: number | null | undefined) =>
  value == null ? "—" : `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;
const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const marketDate = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(`${value}T12:00:00Z`))
    : "—";

const columns = [
  ["ticker", "Ticker"],
  ["day-dollar", "Day $"],
  ["day-percent", "Day %"],
  ["value", "Value"],
  ["total-percent", "Total %"],
] as const;

export const portfolioModule: HomeModule<PortfolioPayload> = {
  id: "portfolio",
  title: "Portfolio",
  placement: "supporting",
  schemaVersion: 1,
  freshForMs: 15 * 60_000,
  maxAgeMs: 60 * 60_000,
  parse: (value) => portfolioPayloadSchema.parse(value),
  renderHeader(snapshot, context) {
    const timestamp = snapshot.collectedAt;
    const label =
      snapshot.status === "available"
        ? "Checked"
        : snapshot.status === "unavailable" && snapshot.payload
          ? "Outdated"
          : snapshot.status;
    return /* HTML */ `<div class="module-title">
      <h2>Portfolio</h2>
      <div class="module-actions">
        <span class="module-info">
          <button
            class="info-trigger"
            type="button"
            aria-label="Portfolio timing information"
            aria-describedby="portfolio-info"
          >
            ⓘ
          </button>
          <span class="info-tooltip" id="portfolio-info" role="tooltip">
            <span
              >${timestamp === null
                ? "Awaiting first update"
                : `<strong>${e(label)}</strong> ${sourceTime(timestamp, context.timezone)}`}</span
            >
          </span>
        </span>
        <form class="module-refresh" action="/api/sync-prices" method="post">
          <button type="submit">Sync prices</button>
        </form>
      </div>
    </div>`;
  },
  render(data, context) {
    const positive = data.gainLoss >= 0;
    const holdings = [...data.holdings].sort((a, b) => {
      if (a.dayReturn == null && b.dayReturn == null) return 0;
      if (a.dayReturn == null) return 1;
      if (b.dayReturn == null) return -1;
      return b.dayReturn - a.dayReturn;
    });
    const rows = holdings
      .map((holding) => {
        const totalPercent =
          holding.gainLossPercent ?? holding.allocation * 100;
        return `<tr
          data-sort-ticker="${e(holding.ticker.toLowerCase())}"
          data-sort-day-dollar="${holding.dayReturn ?? ""}"
          data-sort-day-percent="${holding.dayReturnPercent ?? ""}"
          data-sort-value="${holding.value}"
          data-sort-total-percent="${totalPercent}"
        >
          <td class="portfolio-holding"><strong>${e(holding.ticker)}</strong><span title="${e(holding.name)}">${e(holding.name)}</span></td>
          <td class="${(holding.dayReturn ?? 0) < 0 ? "warning" : (holding.dayReturn ?? 0) > 0 ? "positive" : ""}">${e(signedMoney(holding.dayReturn))}</td>
          <td class="${(holding.dayReturnPercent ?? 0) < 0 ? "warning" : (holding.dayReturnPercent ?? 0) > 0 ? "positive" : ""}">${e(percent(holding.dayReturnPercent))}</td>
          <td><strong>${e(money(holding.value))}</strong>${holding.shares === undefined ? "" : `<span>${e(holding.shares.toLocaleString())} sh</span>`}</td>
          <td class="${totalPercent < 0 ? "warning" : totalPercent > 0 ? "positive" : ""}">${e(percent(totalPercent))}</td>
        </tr>`;
      })
      .join("");
    return /* HTML */ `<div class="portfolio-value">
        ${e(money(data.totalValue))}
      </div>
      <div class="portfolio-performance">
        <p class="portfolio-return ${positive ? "positive" : "warning"}">
          ${positive ? "+" : "−"}${e(money(Math.abs(data.gainLoss)))}
          <span
            >(${positive ? "+" : ""}${data.gainLossPercent.toFixed(1)}%)</span
          >
        </p>
        <p class="meta">Unrealized return · ${data.holdingsCount} holdings</p>
      </div>
      <p class="portfolio-market-time meta">Prices ${e(marketDate(data.latestPriceDate))} · ${
        data.lastSyncedAt
          ? `Last synced ${sourceTime(data.lastSyncedAt, context.timezone)}`
          : "Last sync unavailable"
      }</p>
      <div class="holdings-heading">
        <h3 class="section-label">Holdings</h3>
      </div>
      ${
        holdings.length
          ? `<div class="portfolio-table-scroll">
        <table class="portfolio-table" data-portfolio-table data-expanded="false">
          <thead><tr>
            ${columns
              .map(
                ([key, label]) =>
                  `<th scope="col" aria-sort="${key === "day-dollar" ? "descending" : "none"}"><button type="button" data-portfolio-sort="${key}" data-direction="${key === "day-dollar" ? "desc" : ""}">${e(label)} <span class="sort-arrow" aria-hidden="true">${key === "day-dollar" ? "▼" : ""}</span></button></th>`,
              )
              .join("")}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${
        holdings.length > 5
          ? `<button class="portfolio-expand" type="button" data-portfolio-expand aria-expanded="false">Show all ${holdings.length}</button>`
          : ""
      }`
          : '<p class="empty">No holdings yet.</p>'
      }`;
  },
};
