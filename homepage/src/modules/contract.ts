import type { ModuleSnapshot } from "@tasky/home-feed";

export type RenderContext = {
  taskyOrigin: string;
  timezone: string;
  now: number;
};
/** Only trusted repository code can register a module. Payloads are data, never HTML. */
export interface HomeModule<T> {
  id: string;
  title: string;
  placement: "lead" | "supporting";
  schemaVersion: 1;
  freshForMs: number;
  maxAgeMs: number;
  parse: (value: unknown) => T;
  render: (payload: T, context: RenderContext) => string;
}
export function missingModule<T>(
  module: HomeModule<T>,
  disabled = false,
): ModuleSnapshot {
  return {
    id: module.id,
    schemaVersion: 1,
    scope: "user",
    sourceDataAt: null,
    collectedAt: null,
    freshForMs: module.freshForMs,
    maxAgeMs: module.maxAgeMs,
    status: disabled ? "disabled" : "unavailable",
    ...(disabled ? {} : { error: "awaiting_data" as const }),
    payload: null,
  };
}
