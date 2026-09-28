import { DurableObject } from "cloudflare:workers";
import { identitySchema } from "@tasky/home-feed";
import { objectCall, type Env } from "../env";
import { SerialQueue } from "../serial";
import { backgroundModules } from "../modules/background";

type EnabledUser = { userId: string; modules: Record<string, unknown> };
export class Coordinator extends DurableObject<Env> {
  private queue = new SerialQueue();
  async fetch(request: Request) {
    return this.queue.run(async () => {
      const path = new URL(request.url).pathname;
      if (path === "/enroll") {
        const { userId } = await request.json<{ userId: string }>();
        identitySchema.parse(userId);
        if (!(await this.ctx.storage.get(`user:${userId}`))) {
          const modules = Object.fromEntries(
            backgroundModules.map((module) => [
              module.id,
              module.initialConfig(this.env),
            ]),
          );
          await this.ctx.storage.put(`user:${userId}`, { userId, modules });
        }
        await this.ctx.storage.setAlarm(Date.now() + 1000);
        return Response.json({ ok: true });
      }
      if (path === "/tick") {
        await this.tick();
        return Response.json({ ok: true });
      }
      if (path === "/status") {
        const { userId } = await request.json<{ userId: string }>();
        identitySchema.parse(userId);
        const state = await this.ctx.storage.get<Record<string, unknown>>(
          `collector:${userId}:weather`,
        );
        const times = Array.isArray(state?.requestTimes)
          ? state.requestTimes.filter((time) => typeof time === "number")
          : [];
        return Response.json({
          weather: state
            ? {
                collectedAt: state.collectedAt ?? null,
                nextCheck: state.nextCheck ?? null,
                nextCurrent: state.nextCurrent ?? null,
                nextForecast: state.nextForecast ?? null,
                nextHourly: state.nextHourly ?? null,
                used: times.length,
                error: state.error ?? null,
                errors: state.errors ?? {},
                failures: state.failures ?? 0,
                hasPayload: Boolean(state.payload),
                hourlyVersion: state.hourlyVersion ?? null,
                forecastVersion: state.forecastVersion ?? null,
              }
            : null,
        });
      }
      if (path === "/collect") {
        const { userId } = await request.json<{ userId: string }>();
        identitySchema.parse(userId);
        const user = await this.ctx.storage.get<EnabledUser>(`user:${userId}`);
        if (!user) return new Response(null, { status: 404 });
        await this.collectUser(user, true);
        await objectCall(this.env.PUBLISHERS, user.userId, "/publish", {});
        return Response.json({ ok: true });
      }
      return new Response(null, { status: 404 });
    });
  }
  private async tick() {
    // Bounded batches with a durable cursor keep multi-user scheduling fair.
    const cursor = await this.ctx.storage.get<string>("cursor");
    const users = await this.ctx.storage.list<EnabledUser>({
      prefix: "user:",
      limit: 25,
      ...(cursor ? { startAfter: cursor } : {}),
    });
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    for (const [key, user] of users) {
      await this.collectUser(user, false);
      await this.ctx.storage.put("cursor", key);
    }
    if (users.size < 25) await this.ctx.storage.delete("cursor");
  }
  private async collectUser(user: EnabledUser, force: boolean) {
    if (!force)
      try {
        // Publisher tick also recovers any interrupted enrollment/publication.
        await objectCall(this.env.PUBLISHERS, user.userId, "/tick", {});
      } catch {
        console.warn(JSON.stringify({ event: "homepage_publisher_retry" }));
      }
    for (const module of backgroundModules) {
      if (!Object.hasOwn(user.modules, module.id)) continue;
      try {
        const stateKey = `collector:${user.userId}:${module.id}`;
        if (force) {
          const state =
            await this.ctx.storage.get<Record<string, unknown>>(stateKey);
          if (state) {
            await this.ctx.storage.put(stateKey, {
              ...state,
              nextCheck: 0,
              ...(typeof state.nextCurrent === "number"
                ? { nextCurrent: 0 }
                : {}),
              ...(typeof state.nextForecast === "number"
                ? { nextForecast: 0 }
                : {}),
              ...(typeof state.nextHourly === "number" ? { nextHourly: 0 } : {}),
            });
          }
        }
        const snapshot = await module.collect({
          env: this.env,
          userId: user.userId,
          config: user.modules[module.id],
          force,
          load: <T>() => this.ctx.storage.get<T>(stateKey),
          save: (value) => this.ctx.storage.put(stateKey, value),
        });
        if (snapshot) {
          console.warn(
            JSON.stringify({
              event: "homepage_collector_snapshot",
              module: module.id,
              force,
              status: snapshot.status,
              collectedAt: snapshot.collectedAt,
              sourceDataAt: snapshot.sourceDataAt,
              error: snapshot.error ?? null,
            }),
          );
          await objectCall(
            this.env.PUBLISHERS,
            user.userId,
            "/accept-module",
            { userId: user.userId, snapshot },
          );
        } else {
          console.warn(
            JSON.stringify({
              event: "homepage_collector_snapshot",
              module: module.id,
              force,
              empty: true,
            }),
          );
        }
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "homepage_collector_retry",
            module: module.id,
            error: error instanceof Error ? error.name : "UnknownError",
          }),
        );
      }
    }
  }
  async alarm() {
    await this.queue.run(() => this.tick());
  }
}
