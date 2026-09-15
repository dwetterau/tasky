import { DurableObject } from "cloudflare:workers";
import {
  editionSchema,
  exportSchema,
  feedSchema,
  identitySchema,
  moduleSchema,
  timezoneSchema,
  withFreshness,
  type Feed,
  type ModuleSnapshot,
} from "@tasky/home-feed";
import { HttpError, origin, type Env } from "../env";
import { SerialQueue } from "../serial";
import { digest } from "../transport";
import { taskyService } from "../ingestion/tasky-service";
import { ingestTasky, taskyModule } from "../modules/tasky";
import { weatherModule } from "../modules/weather";
import { missingModule } from "../modules/contract";
import { validateModule } from "../modules/registry";
import { renderEdition } from "../rendering/page";

export type Enrollment = {
  userId: string;
  timezone: string;
  displayName: string;
};
type PublisherState = Enrollment & {
  enrolledAt: number;
  provisioned: boolean;
  provisionAfter: number;
  modules: ModuleSnapshot[];
  sourceRevision: number;
  editionRevision: number;
  dirty: boolean;
  retryAttempt: number;
  retryAfter: number;
  publishedRevision?: number;
  publishedSourceRevision?: number;
  lastPublishedAt: number;
  lastError?: "provisioning_failed" | "publication_failed";
};
type Receipt = { exportId: string; revision: number; hash: string };

export class UserPublisher extends DurableObject<Env> {
  private queue = new SerialQueue();
  async fetch(request: Request) {
    return this.queue.run(async () => {
      try {
        const path = new URL(request.url).pathname;
        let state = await this.ctx.storage.get<PublisherState>("state");
        if (path === "/enroll") {
          const input = await request.json<Enrollment>();
          identitySchema.parse(input.userId);
          timezoneSchema.parse(input.timezone);
          if (state && state.userId !== input.userId)
            throw new HttpError(403, "Wrong publisher");
          if (!state) {
            state = {
              userId: input.userId,
              timezone: input.timezone,
              displayName: input.displayName.slice(0, 80),
              enrolledAt: Date.now(),
              provisioned: false,
              provisionAfter: 0,
              modules: [
                missingModule(taskyModule),
                missingModule(weatherModule, !this.env.WEATHER_CONFIG),
              ],
              sourceRevision: 0,
              editionRevision: 0,
              dirty: true,
              retryAttempt: 0,
              retryAfter: 0,
              lastPublishedAt: 0,
            };
            // Schedule first: an interruption cannot leave durable state without work.
            await this.ctx.storage.setAlarm(Date.now() + 1000);
            await this.ctx.storage.put("state", state);
          }
          return Response.json({ enrolled: true });
        }
        if (!state) throw new HttpError(403, "Not enrolled");
        if (path === "/accept-tasky") {
          const { body } = await request.json<{ body: string }>();
          const envelope = exportSchema.parse(JSON.parse(body));
          if (
            envelope.userId !== state.userId ||
            envelope.timezone !== state.timezone
          )
            throw new HttpError(403, "Wrong enrollment");
          if (envelope.exportedAt > Date.now() + 60_000)
            throw new HttpError(400, "Future export");
          const hash = await digest(body);
          const byId = await this.ctx.storage.get<Receipt>(
            `receipt:id:${envelope.exportId}`,
          );
          const byRevision = await this.ctx.storage.get<Receipt>(
            `receipt:revision:${envelope.sourceRevision}`,
          );
          if (
            (byId &&
              (byId.hash !== hash ||
                byId.revision !== envelope.sourceRevision)) ||
            (byRevision &&
              (byRevision.hash !== hash ||
                byRevision.exportId !== envelope.exportId))
          )
            throw new HttpError(409, "Conflicting export");
          if (byId || byRevision)
            return Response.json({ accepted: true, duplicate: true });
          if (envelope.sourceRevision < state.sourceRevision)
            return Response.json({ accepted: true, older: true });
          if (envelope.sourceRevision === state.sourceRevision)
            throw new HttpError(409, "Conflicting revision");
          const receipt = {
            hash,
            exportId: envelope.exportId,
            revision: envelope.sourceRevision,
          };
          state.modules = [
            ...state.modules.filter(
              (m) =>
                m.id !== "tasky" &&
                (!envelope.portfolio || m.id !== "portfolio"),
            ),
            ingestTasky(envelope),
            ...(envelope.portfolio ? [validateModule(envelope.portfolio)] : []),
          ];
          state.sourceRevision = envelope.sourceRevision;
          state.provisioned = true;
          state.dirty = true;
          await this.ctx.storage.setAlarm(
            Math.max(Date.now() + 1000, state.lastPublishedAt + 1100),
          );
          // Atomically accept the receipt and new snapshot before acknowledging.
          await this.ctx.storage.transaction(async (transaction) => {
            await transaction.put(`receipt:id:${envelope.exportId}`, receipt);
            await transaction.put(
              `receipt:revision:${envelope.sourceRevision}`,
              receipt,
            );
            await transaction.put("state", state!);
          });
          return Response.json({ accepted: true });
        }
        if (path === "/accept-module") {
          const { userId, snapshot } = await request.json<{
            userId: string;
            snapshot: ModuleSnapshot;
          }>();
          if (userId !== state.userId || snapshot.id === "tasky")
            throw new HttpError(403, "Wrong module");
          const validated = validateModule(moduleSchema.parse(snapshot));
          const previous = state.modules.find((m) => m.id === snapshot.id);
          if (
            previous?.collectedAt &&
            validated.collectedAt &&
            previous.collectedAt > validated.collectedAt
          )
            return Response.json({ older: true });
          if (JSON.stringify(previous) !== JSON.stringify(validated)) {
            state.modules = [
              ...state.modules.filter((m) => m.id !== snapshot.id),
              validated,
            ];
            state.dirty = true;
            await this.ctx.storage.setAlarm(
              Math.max(Date.now() + 1000, state.lastPublishedAt + 1100),
            );
            await this.ctx.storage.put("state", state);
          }
          return Response.json({ accepted: true });
        }
        if (path === "/status") {
          const lastError =
            state.lastError ??
            (state.provisioned &&
            !state.sourceRevision &&
            Date.now() - state.enrolledAt > 300_000
              ? "initial_export_delayed"
              : undefined);
          return Response.json({
            userId: state.userId,
            state: lastError
              ? "retrying"
              : state.publishedSourceRevision
                ? "ready"
                : "preparing",
            lastError,
            enrolledAt: state.enrolledAt,
            revision: state.publishedRevision ?? 0,
            sourceRevision: state.sourceRevision,
          });
        }
        if (path === "/tick") {
          await this.work(state);
          return Response.json({ ok: true });
        }
        return new Response(null, { status: 404 });
      } catch (error) {
        const invalid =
          error instanceof SyntaxError ||
          (error instanceof Error && error.name === "ZodError");
        return Response.json(
          { error: "Publisher operation failed" },
          {
            status:
              error instanceof HttpError ? error.status : invalid ? 400 : 503,
          },
        );
      }
    });
  }
  private async work(state: PublisherState) {
    const now = Date.now();
    // Persist a watchdog before any external effect, even on an alarm retry.
    await this.ctx.storage.setAlarm(now + 60_000);
    if (!state.provisioned && now >= state.provisionAfter) {
      try {
        await taskyService(this.env, "/api/homepage/enroll", {
          userId: state.userId,
          timezone: state.timezone,
        });
        state.provisioned = true;
        state.lastError = undefined;
      } catch {
        state.lastError = "provisioning_failed";
        state.provisionAfter = now + 60_000;
      }
      await this.ctx.storage.put("state", state);
    }
    // Recompute statuses at freshness boundaries even when sources stop sending.
    const freshModules = state.modules.map((module) => {
      // Bound provider-data retention even if the coordinator never runs again.
      if (
        module.id === "weather" &&
        module.sourceDataAt !== null &&
        now - module.sourceDataAt > 12 * 3600_000
      )
        return { ...module, payload: null, status: "unavailable" as const };
      return withFreshness(module, now);
    });
    if (JSON.stringify(freshModules) !== JSON.stringify(state.modules))
      state.dirty = true;
    state.modules = freshModules;
    if (
      state.dirty &&
      now >= state.retryAfter &&
      now >= state.lastPublishedAt + 1100
    ) {
      try {
        const feed: Feed = feedSchema.parse({
          schemaVersion: 1,
          userId: state.userId,
          timezone: state.timezone,
          displayName: state.displayName,
          revision: state.editionRevision + 1,
          publishedAt: now,
          modules: [...state.modules].sort((a, b) =>
            a.id === "tasky"
              ? -1
              : b.id === "tasky"
                ? 1
                : a.id.localeCompare(b.id),
          ),
        });
        const edition = editionSchema.parse({
          schemaVersion: 1,
          feed,
          html: renderEdition(feed, origin(this.env.TASKY_ORIGIN)),
        });
        state.editionRevision = feed.revision;
        // A crash after KV succeeds re-publishes latest state with a higher revision.
        await this.ctx.storage.put("state", state);
        await this.env.EDITIONS.put(
          `edition:${state.userId}`,
          JSON.stringify(edition),
          { expirationTtl: 86400 },
        );
        state.dirty = false;
        state.retryAttempt = 0;
        state.retryAfter = 0;
        state.lastPublishedAt = now;
        state.publishedRevision = feed.revision;
        state.publishedSourceRevision = state.sourceRevision;
        if (state.lastError === "publication_failed")
          state.lastError = undefined;
      } catch {
        state.lastError = "publication_failed";
        state.retryAttempt += 1;
        state.retryAfter =
          now + Math.min(300_000, 2000 * 2 ** Math.min(state.retryAttempt, 8));
      }
    }
    // Renew the envelope TTL daily even for a permanently empty account.
    if (now - state.lastPublishedAt > 12 * 3600_000) state.dirty = true;
    await this.ctx.storage.put("state", state);
    const next = state.dirty
      ? Math.max(now + 1100, state.retryAfter, state.lastPublishedAt + 1100)
      : now + 60_000;
    await this.ctx.storage.setAlarm(next);
  }
  async alarm() {
    await this.queue.run(async () => {
      const state = await this.ctx.storage.get<PublisherState>("state");
      if (state) await this.work(state);
    });
  }
}
