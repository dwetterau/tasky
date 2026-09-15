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
          const snapshot = await module.collect({
            env: this.env,
            userId: user.userId,
            config: user.modules[module.id],
            load: <T>() => this.ctx.storage.get<T>(stateKey),
            save: (value) => this.ctx.storage.put(stateKey, value),
          });
          if (snapshot)
            await objectCall(
              this.env.PUBLISHERS,
              user.userId,
              "/accept-module",
              { userId: user.userId, snapshot },
            );
        } catch {
          console.warn(
            JSON.stringify({
              event: "homepage_collector_retry",
              module: module.id,
            }),
          );
        }
      }
      await this.ctx.storage.put("cursor", key);
    }
    if (users.size < 25) await this.ctx.storage.delete("cursor");
  }
  async alarm() {
    await this.queue.run(() => this.tick());
  }
}
