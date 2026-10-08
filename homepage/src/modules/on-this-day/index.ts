import {
  formatOnThisDayDate,
  onThisDayPayloadSchema,
  widgetDefinitions,
  type OnThisDayPayload,
} from "@tasky/home-feed/widgets";
import { micromark } from "micromark";
import type { HomeModule } from "../contract";
import { escapeHtml as e } from "../../rendering/html";

export const onThisDayModule: HomeModule<OnThisDayPayload> = {
  id: "on-this-day",
  title: "On this day",
  placement: "supporting",
  schemaVersion: 1,
  freshForMs: widgetDefinitions["on-this-day"].freshForMs,
  maxAgeMs: widgetDefinitions["on-this-day"].maxAgeMs,
  parse: (value) => onThisDayPayloadSchema.parse(value),
  render(data) {
    return `<div class="on-this-day">
      <time class="widget-date" datetime="${e(data.date)}">${e(formatOnThisDayDate(data.date))}</time>
      <div class="briefing-markdown">${micromark(data.markdown)}</div>
    </div>`;
  },
};
