import type { ModuleSnapshot } from "@tasky/home-feed";
import type { HomeModule, RenderContext } from "./contract";
import { taskyModule } from "./tasky";
import { weatherModule } from "./weather";

// Add a module here, a versioned payload schema to home-feed, and a trusted
// collector/ingestor. The publisher and HTTP read path need no provider logic.
export const modules: readonly HomeModule<unknown>[] = [taskyModule, weatherModule] as HomeModule<unknown>[];
export function moduleFor(id: string) {
  const module = modules.find(candidate => candidate.id === id);
  if (!module) throw new Error("Unregistered module");
  return module;
}
export function validateModule(snapshot: ModuleSnapshot) {
  const module = moduleFor(snapshot.id);
  if (snapshot.schemaVersion !== module.schemaVersion) throw new Error("Unsupported module version");
  return { ...snapshot, payload: snapshot.payload === null ? null : module.parse(snapshot.payload) };
}
export function renderModule(snapshot: ModuleSnapshot, context: RenderContext) {
  const module = moduleFor(snapshot.id);
  return snapshot.payload === null ? "" : module.render(module.parse(snapshot.payload), context);
}
