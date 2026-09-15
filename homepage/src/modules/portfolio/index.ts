import {
  portfolioPayloadSchema,
  type PortfolioPayload,
} from "@tasky/home-feed";
import { escapeHtml as e } from "../../rendering/html";
import type { HomeModule } from "../contract";
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

export const portfolioModule: HomeModule<PortfolioPayload> = {
  id: "portfolio",
  title: "Portfolio",
  placement: "supporting",
  schemaVersion: 1,
  freshForMs: 15 * 60_000,
  maxAgeMs: 60 * 60_000,
  parse: (value) => portfolioPayloadSchema.parse(value),
  render(data) {
    const positive = data.gainLoss >= 0;
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
      <h3 class="section-label holdings-label">Largest positions</h3>
      <ul class="holdings">
        ${data.holdings
          .map(
            (holding) => `
        <li><div class="row"><strong title="${e(holding.name)}">${e(holding.ticker)}</strong>
          <span>${e(money(holding.value))} <span class="muted">· ${(holding.allocation * 100).toFixed(0)}%</span></span></div>
          <progress max="1" value="${Math.max(0, Math.min(1, holding.allocation))}" aria-label="${e(holding.ticker)} allocation"></progress></li>`,
          )
          .join("") || '<li class="empty">No holdings yet.</li>'}
      </ul>
      <p class="meta">Saved values from Tasky.</p>`;
  },
};
