import type { ModuleSnapshot } from "@tasky/home-feed";
import type { Env } from "../env";
import {
  collectWeather,
  weatherConfigSchema,
  type WeatherState,
} from "./weather/collector";

export interface CollectionContext {
  env: Env;
  userId: string;
  config: unknown;
  /** Private control state, separate from the published module payload. */
  load: <T>() => Promise<T | undefined>;
  save: (state: unknown) => Promise<void>;
}
export interface BackgroundModule {
  id: string;
  initialConfig: (env: Env) => unknown;
  collect: (context: CollectionContext) => Promise<ModuleSnapshot | undefined>;
}

/** Register future sports/fantasy collectors here. Each gets its own private
 * state namespace, retry schedule and payload validator; no page-route changes. */
export const backgroundModules: readonly BackgroundModule[] = [
  {
    id: "weather",
    initialConfig: (env) =>
      env.WEATHER_CONFIG
        ? weatherConfigSchema.parse(JSON.parse(env.WEATHER_CONFIG))
        : null,
    async collect({ env, userId, config, load, save }) {
      const result = await collectWeather(
        env,
        userId,
        config === null ? null : weatherConfigSchema.parse(config),
        await load<WeatherState>(),
        save,
      );
      return result.snapshot;
    },
  },
];
