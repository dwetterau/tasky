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
const chartDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));

const columns = [
  ["ticker", "Ticker"],
  ["day-dollar", "Day $"],
  ["day-percent", "Day %"],
  ["value", "Value"],
  ["total-percent", "Total %"],
] as const;

type NamedPortfolio = NonNullable<PortfolioPayload["portfolios"]>[number];

function renderPortfolioHistory(data: NamedPortfolio) {
  const history = (data.history?.values ?? []).flatMap((value, index) => {
    if (value === null || !data.history) return [];
    const date = new Date(`${data.history.startDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return [{ date: date.toISOString().slice(0, 10), value }];
  });
  if (history.length < 2) return "";

  const width = 640;
  const height = 144;
  const timestamps = history.map((point) =>
    new Date(`${point.date}T12:00:00Z`).getTime(),
  );
  const values = history.map((point) => point.value);
  const firstTimestamp = timestamps[0]!;
  const lastTimestamp = timestamps[timestamps.length - 1]!;
  const historyDays =
    Math.floor((lastTimestamp - firstTimestamp) / 86_400_000) + 1;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const rawRange = maximum - minimum;
  const padding = rawRange > 0 ? rawRange * 0.08 : Math.max(maximum * 0.02, 1);
  const yMinimum = minimum - padding;
  const yMaximum = maximum + padding;
  const yRange = yMaximum - yMinimum;
  const xRange = Math.max(lastTimestamp - firstTimestamp, 1);
  const coordinates = history.map((point, index) => ({
    x: ((timestamps[index]! - firstTimestamp) / xRange) * width,
    y: height - ((point.value - yMinimum) / yRange) * height,
  }));
  const line = coordinates
    .map(
      ({ x, y }, index) =>
        `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`,
    )
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const first = history[0]!;
  const last = history[history.length - 1]!;
  const change = last.value - first.value;
  const changePercent = first.value === 0 ? null : (change / first.value) * 100;
  const changeLabel = `${signedMoney(change)}${changePercent === null ? "" : ` (${percent(changePercent)})`}`;
  const toneClass = change < 0 ? "warning" : change > 0 ? "positive" : "";
  const rangeLabel = `${chartDate(first.date)} to ${chartDate(last.date)}`;
  const serializedValues = data.history!.values
    .map((value) => value ?? "")
    .join(",");

  return /* HTML */ `<figure
    class="portfolio-history"
    data-portfolio-history
    data-history-start="${e(data.history!.startDate)}"
    data-history-values="${e(serializedValues)}"
  >
    <figcaption>
      <span>Value · ${historyDays} ${historyDays === 1 ? "day" : "days"}</span>
      <strong class="${toneClass}">${e(changeLabel)}</strong>
    </figcaption>
    <svg
      viewBox="0 0 ${width} ${height}"
      preserveAspectRatio="none"
      role="img"
      tabindex="0"
      data-history-chart
      aria-label="${e(`${data.name} portfolio value from ${chartDate(first.date)}, ${money(first.value)}, to ${chartDate(last.date)}, ${money(last.value)}. Use the arrow keys to inspect daily values.`)}"
    >
      <path class="portfolio-history-area" d="${area}" aria-hidden="true"></path>
      <path class="portfolio-history-line" d="${line}" aria-hidden="true"></path>
      <line class="portfolio-history-cursor" data-history-cursor y1="0" y2="${height}" hidden aria-hidden="true"></line>
      <circle class="portfolio-history-point" data-history-point r="4" hidden aria-hidden="true"></circle>
      <circle class="portfolio-history-end" cx="${coordinates.at(-1)!.x.toFixed(1)}" cy="${coordinates.at(-1)!.y.toFixed(1)}" r="4" aria-hidden="true"></circle>
    </svg>
    <div class="portfolio-history-tooltip" data-history-tooltip data-side="left" hidden aria-live="polite">
      <time data-history-tooltip-date></time>
      <strong data-history-tooltip-value></strong>
      <span data-history-tooltip-change></span>
    </div>
    <div class="portfolio-history-dates" aria-label="${e(rangeLabel)}">
      <time datetime="${e(first.date)}">${e(chartDate(first.date))}</time>
      <time datetime="${e(last.date)}">${e(chartDate(last.date))}</time>
    </div>
  </figure>`;
}

function renderPortfolio(data: NamedPortfolio) {
  const holdings = [...data.holdings].sort((a, b) => {
    if (a.dayReturn == null && b.dayReturn == null) return 0;
    if (a.dayReturn == null) return 1;
    if (b.dayReturn == null) return -1;
    return b.dayReturn - a.dayReturn;
  });
  const rows = holdings
    .map((holding) => {
      const totalPercent = holding.gainLossPercent ?? holding.allocation * 100;
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
    ${renderPortfolioHistory(data)}
    <div class="holdings-heading">
      <h3 class="section-label">Holdings</h3>
    </div>
    ${holdings.length
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
      : '<p class="empty">No holdings yet.</p>'}`;
}

export const portfolioModule: HomeModule<PortfolioPayload> = {
  id: "portfolio",
  title: "Portfolio",
  placement: "supporting",
  schemaVersion: 1,
  freshForMs: 15 * 60_000,
  maxAgeMs: 60 * 60_000,
  parse: (value) => portfolioPayloadSchema.parse(value),
  renderHeader(snapshot, context) {
    const data =
      snapshot.payload === null
        ? null
        : portfolioPayloadSchema.parse(snapshot.payload);
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
            <span
              ><strong>Prices last synced</strong> ${data?.lastSyncedAt
                ? sourceTime(data.lastSyncedAt, context.timezone)
                : "Unavailable"}<br />
              When prices and positions were last synchronized.</span
            >
            <span
              ><strong>Snapshot date</strong> ${e(
                marketDate(data?.latestPriceDate),
              )}<br />
              Market date used for daily price changes.</span
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
    const portfolios = data.portfolios ?? [
      {
        id: "legacy-schwab",
        name: "Schwab",
        currency: data.currency,
        totalValue: data.totalValue,
        gainLoss: data.gainLoss,
        gainLossPercent: data.gainLossPercent,
        holdingsCount: data.holdingsCount,
        lastSyncedAt: data.lastSyncedAt,
        latestPriceDate: data.latestPriceDate,
        holdings: data.holdings,
      },
    ];
    const tabs =
      portfolios.length > 1
        ? `<div class="portfolio-tabs" role="tablist" aria-label="Portfolio">
          ${portfolios
            .map(
              (portfolio, index) =>
                `<button type="button" role="tab" data-portfolio-tab="${e(portfolio.id)}" aria-selected="${index === 0}" tabindex="${index === 0 ? "0" : "-1"}">${e(portfolio.name)}</button>`,
            )
            .join("")}
        </div>`
        : "";
    const panels = portfolios
      .map(
        (portfolio, index) =>
          `<div class="portfolio-panel" data-portfolio-panel="${e(portfolio.id)}"${index === 0 ? "" : " hidden"}>${renderPortfolio(portfolio)}</div>`,
      )
      .join("");
    return `${tabs}${panels}`;
  },
};
