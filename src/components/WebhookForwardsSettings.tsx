"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useTrackedMutation } from "@/lib/useTrackedMutation";

type Source = "strava" | "generic";

const inputClass =
  "w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm";
const linkButtonClass = "text-xs text-accent hover:underline disabled:opacity-50";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-(--muted) mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

export function WebhookForwardsSettings() {
  const forwards = useQuery(api.webhookForwards.list, {});
  const create = useTrackedMutation(api.webhookForwards.create);
  const setEnabled = useTrackedMutation(api.webhookForwards.setEnabled);
  const remove = useTrackedMutation(api.webhookForwards.remove);
  const sendTest = useTrackedMutation(api.webhookForwards.sendTest);
  const startStravaAuthorization = useTrackedMutation(
    api.webhookForwards.startStravaAuthorization,
  );
  const stravaSubscribe = useAction(api.webhookForwards.stravaSubscribe);
  const stravaUnsubscribe = useAction(api.webhookForwards.stravaUnsubscribe);

  const [name, setName] = useState("");
  const [source, setSource] = useState<Source>("strava");
  const [routine, setRoutine] = useState("");
  const [routineToken, setRoutineToken] = useState("");
  const [stravaClientId, setStravaClientId] = useState("");
  const [stravaClientSecret, setStravaClientSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<Id<"webhookForwards"> | null>(null);

  const canCreate =
    name.trim() &&
    routine.trim() &&
    routineToken.trim() &&
    (source !== "strava" || (stravaClientId.trim() && stravaClientSecret.trim()));

  const run = async (
    id: Id<"webhookForwards"> | null,
    work: () => Promise<unknown>,
  ) => {
    setError(null);
    setBusyId(id);
    try {
      const result = await work();
      if (
        result &&
        typeof result === "object" &&
        "ok" in result &&
        !result.ok &&
        "error" in result
      ) {
        setError(String(result.error));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = () =>
    run(null, async () => {
      await create({
        name: name.trim(),
        source,
        routine: routine.trim(),
        routineToken: routineToken.trim(),
        ...(source === "strava"
          ? {
              stravaClientId: stravaClientId.trim(),
              stravaClientSecret: stravaClientSecret.trim(),
            }
          : {}),
      });
      setName("");
      setRoutine("");
      setRoutineToken("");
      setStravaClientId("");
      setStravaClientSecret("");
    });

  const handleSubscribe = (id: Id<"webhookForwards">) =>
    run(id, async () => {
      const result = await stravaSubscribe({ id });
      if (
        !result.ok &&
        result.error.includes("already has a subscription") &&
        window.confirm(`${result.error}\n\nDelete it and point Strava here?`)
      ) {
        return await stravaSubscribe({ id, replaceExisting: true });
      }
      return result;
    });

  return (
    <div className="bg-(--card-bg) border border-(--card-border) rounded-xl p-5 mt-6">
      <h2 className="text-base font-medium mb-2">Webhook Forwards</h2>
      <p className="text-sm text-(--muted) mb-4">
        Each forward gets a private URL. Anything posted to it is sent to a
        Claude Code routine through the routine&apos;s API trigger. Add an API
        trigger to the routine at{" "}
        <a
          href="https://claude.ai/code/routines"
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          claude.ai/code/routines
        </a>{" "}
        and paste its fire URL and token here. The routine&apos;s prompt should
        tell it to read the <code>routine-fire-payload</code> block.
      </p>

      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Post-run recap"
            className={inputClass}
          />
        </Field>
        <Field label="Source">
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as Source)}
            className={inputClass}
          >
            <option value="strava">Strava (new activities)</option>
            <option value="generic">Generic webhook</option>
          </select>
        </Field>
        <Field label="Routine fire URL or ID">
          <input
            type="text"
            value={routine}
            onChange={(event) => setRoutine(event.target.value)}
            placeholder="https://api.anthropic.com/v1/claude_code/routines/trig_.../fire"
            className={inputClass}
          />
        </Field>
        <Field label="Routine token">
          <input
            type="password"
            value={routineToken}
            onChange={(event) => setRoutineToken(event.target.value)}
            placeholder="sk-ant-oat01-..."
            className={inputClass}
          />
        </Field>
        {source === "strava" ? (
          <>
            <Field label="Strava client ID">
              <input
                type="text"
                value={stravaClientId}
                onChange={(event) => setStravaClientId(event.target.value)}
                placeholder="123456"
                className={inputClass}
              />
            </Field>
            <Field label="Strava client secret">
              <input
                type="password"
                value={stravaClientSecret}
                onChange={(event) => setStravaClientSecret(event.target.value)}
                placeholder="From strava.com/settings/api"
                className={inputClass}
              />
            </Field>
          </>
        ) : null}
      </div>
      <div className="flex justify-end mb-4">
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={!canCreate}
          className="px-4 py-2 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add Forward
        </button>
      </div>
      {error ? <p className="text-sm text-red-400 mb-3">{error}</p> : null}

      {forwards === undefined ? (
        <p className="text-sm text-(--muted)">Loading...</p>
      ) : forwards.length === 0 ? (
        <p className="text-sm text-(--muted)">No webhook forwards yet.</p>
      ) : (
        <div className="space-y-2">
          {forwards.map((forward) => {
            const busy = busyId === forward._id;
            return (
              <div
                key={forward._id}
                className="rounded-lg border border-(--card-border) px-3 py-2"
              >
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-medium truncate">
                    {forward.name}
                    <span className="ml-2 text-xs text-(--muted)">
                      {forward.source} → {forward.routineId}
                      {forward.enabled ? "" : " · paused"}
                    </span>
                  </p>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(forward._id, () => sendTest({ id: forward._id }))}
                      className={linkButtonClass}
                    >
                      Send test
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void setEnabled({ id: forward._id, enabled: !forward.enabled })
                      }
                      className={linkButtonClass}
                    >
                      {forward.enabled ? "Pause" : "Resume"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete "${forward.name}"?`)) {
                          void remove({ id: forward._id });
                        }
                      }}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <code className="text-xs text-(--muted) truncate">{forward.url}</code>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(forward.url)}
                    className={linkButtonClass}
                  >
                    Copy
                  </button>
                </div>
                {forward.strava ? (
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-(--muted)">
                    <span>
                      {forward.strava.subscriptionId === null
                        ? "1. Not subscribed"
                        : `1. Subscribed (#${forward.strava.subscriptionId})`}
                    </span>
                    {forward.strava.subscriptionId === null ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleSubscribe(forward._id)}
                        className={linkButtonClass}
                      >
                        {busy ? "Working..." : "Subscribe"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(forward._id, () => stravaUnsubscribe({ id: forward._id }))
                        }
                        className={linkButtonClass}
                      >
                        Unsubscribe
                      </button>
                    )}
                    <span>
                      {forward.strava.athleteId === null
                        ? "2. Athlete not authorized"
                        : `2. Athlete ${forward.strava.athleteId} authorized`}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(forward._id, async () => {
                          window.location.href = await startStravaAuthorization({
                            id: forward._id,
                          });
                        })
                      }
                      className={linkButtonClass}
                    >
                      {forward.strava.athleteId === null ? "Authorize" : "Re-authorize"}
                    </button>
                  </div>
                ) : null}
                {forward.deliveries.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-(--muted)">
                    {forward.deliveries.map((delivery) => (
                      <li key={delivery._id} className="truncate">
                        {new Date(delivery.receivedAt).toLocaleString()} ·{" "}
                        {delivery.summary} ·{" "}
                        {delivery.status === "delivered" && delivery.sessionUrl ? (
                          <a
                            href={delivery.sessionUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline"
                          >
                            session started
                          </a>
                        ) : delivery.status === "failed" ? (
                          <span className="text-red-400">
                            failed
                            {delivery.responseStatus ? ` (${delivery.responseStatus})` : ""}
                            {delivery.error ? `: ${delivery.error}` : ""}
                          </span>
                        ) : (
                          delivery.status
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
