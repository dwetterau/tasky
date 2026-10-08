import {
  briefingRenderPayloadSchema,
  formatOnThisDayDate,
  type BriefingRenderPayload,
} from "@tasky/home-feed/widgets";
import { micromark } from "micromark";
import type { HomeModule } from "../contract";
import { escapeHtml as e } from "../../rendering/html";

export const briefingModule: HomeModule<BriefingRenderPayload> = {
  id: "briefing",
  title: "Briefing",
  placement: "supporting",
  schemaVersion: 1,
  freshForMs: 18 * 60 * 60_000,
  maxAgeMs: 7 * 24 * 60 * 60_000,
  parse: (value) => briefingRenderPayloadSchema.parse(value),
  render(data) {
    const date =
      "date" in data
        ? `<time class="widget-date" datetime="${e(data.date)}">${e(formatOnThisDayDate(data.date))}</time>`
        : "";
    return `${date}<div class="briefing-markdown">${micromark(data.markdown)}</div>`;
  },
};
