import { DurableObject } from "cloudflare:workers";
import { allowed, HttpError, type Env } from "../env";
import { SerialQueue } from "../serial";
import { decryptGrant, encryptGrant, issueSession, REMEMBER_SECONDS, type Identity } from "./credentials";
import { refreshGrant, type LoginAttempt } from "./oauth";

type RememberedGrant = { sid: string; identity: Identity; encryptedRefresh: string; expiresAt: number; lastRenewedAt: number };

export class HomepageSession extends DurableObject<Env> {
  private queue = new SerialQueue();
  async fetch(request: Request) {
    return this.queue.run(async () => {
      try {
        const path = new URL(request.url).pathname;
        if (path === "/begin") {
          if (await this.ctx.storage.get("attempt")) throw new HttpError(409, "Login already started");
          const attempt = await request.json<LoginAttempt>();
          await this.ctx.storage.put("attempt", attempt);
          await this.ctx.storage.setAlarm(attempt.expiresAt);
          return Response.json({ ok: true });
        }
        if (path === "/consume") {
          const { state } = await request.json<{ state: string }>();
          const attempt = await this.ctx.storage.get<LoginAttempt>("attempt");
          if (!attempt || attempt.expiresAt <= Date.now() || attempt.state !== state) throw new HttpError(401, "Invalid login attempt");
          // Delete before exchanging the code. An interrupted callback must restart.
          await this.ctx.storage.delete("attempt");
          return Response.json(attempt);
        }
        if (path === "/remember") {
          const { sid, identity, refreshToken } = await request.json<{ sid: string; identity: Identity; refreshToken: string }>();
          if (!allowed(this.env, identity.userId, identity.email, identity.emailVerified)) throw new HttpError(403, "Account not enrolled");
          if (await this.ctx.storage.get("grant") || await this.ctx.storage.get("revoked")) throw new HttpError(409, "Session already used");
          const grant: RememberedGrant = { sid, identity, encryptedRefresh: await encryptGrant(this.env, refreshToken, sid), expiresAt: Date.now() + REMEMBER_SECONDS * 1000, lastRenewedAt: Date.now() };
          await this.ctx.storage.put("grant", grant);
          await this.ctx.storage.setAlarm(grant.expiresAt);
          return Response.json({ token: await issueSession(this.env, identity.userId, sid) });
        }
        if (path === "/renew") {
          const grant = await this.ctx.storage.get<RememberedGrant>("grant");
          if (!grant || grant.expiresAt <= Date.now() || !allowed(this.env, grant.identity.userId, grant.identity.email, grant.identity.emailVerified)) throw new HttpError(401, "Sign in again");
          try {
            const next = await refreshGrant(this.env, await decryptGrant(this.env, grant.encryptedRefresh, grant.sid), grant.identity.userId);
            grant.encryptedRefresh = await encryptGrant(this.env, next, grant.sid);
            grant.lastRenewedAt = Date.now();
            await this.ctx.storage.put("grant", grant);
          } catch {
            // No cookie-only renewal. Even a transient provider failure requires
            // sign-in again if refreshing the remembered grant cannot be verified.
            await this.ctx.storage.delete("grant");
            throw new HttpError(401, "Sign in again");
          }
          return Response.json({ token: await issueSession(this.env, grant.identity.userId, grant.sid) });
        }
        if (path === "/revoke") {
          await this.ctx.storage.delete("grant");
          await this.ctx.storage.put("revoked", true);
          await this.ctx.storage.setAlarm(Date.now() + REMEMBER_SECONDS * 1000);
          return Response.json({ ok: true });
        }
        return new Response(null, { status: 404 });
      } catch (error) { return Response.json({ error: "Session operation failed" }, { status: error instanceof HttpError ? error.status : 500 }); }
    });
  }
  async alarm() {
    await this.queue.run(async () => {
      const grant = await this.ctx.storage.get<RememberedGrant>("grant");
      if (!grant || grant.expiresAt <= Date.now()) await this.ctx.storage.deleteAll();
      else await this.ctx.storage.setAlarm(grant.expiresAt);
    });
  }
}
