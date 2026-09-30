import {
  briefingPayloadSchema,
  type BriefingPayload,
} from "@tasky/home-feed/widgets";
import { micromark } from "micromark";
import type { HomeModule } from "../contract";

export const briefingModule: HomeModule<BriefingPayload> = {
  id: "briefing",
  title: "Briefing",
  placement: "supporting",
  schemaVersion: 1,
  freshForMs: 18 * 60 * 60_000,
  maxAgeMs: 7 * 24 * 60 * 60_000,
  parse: (value) => briefingPayloadSchema.parse(value),
  render(data) {
    return `<div class="briefing-markdown">${micromark(data.markdown)}</div>`;
  },
};
