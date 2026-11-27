"use client";

import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { isSessionLive, type LiveSession } from "./portfolioLive";

const LIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 120_000;

/**
 * Polls live prices while `enabled`: quickly during the session, slowly when
 * the market is closed, and not at all while the tab is in the background.
 */
export function useLivePortfolio(tickers: string[], enabled: boolean) {
  const getIntraday = useAction(api.portfolioLive.getIntraday);
  const [session, setSession] = useState<LiveSession | null>(null);
  const key = [...new Set(tickers)].sort().join(",");

  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    const poll = async () => {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      let delay = IDLE_POLL_MS;
      try {
        const result = await getIntraday({ tickers: key.split(",") });
        if (cancelled) return;
        // A failed poll keeps the last good prices on screen.
        if (result.session) {
          setSession(result.session);
          if (isSessionLive(result.session)) delay = LIVE_POLL_MS;
        }
      } catch {
        // Retried on the next tick.
      } finally {
        inFlight = false;
        if (!cancelled) timer = setTimeout(() => void poll(), delay);
      }
    };
    const onVisibility = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      void poll();
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, getIntraday, key]);

  return enabled && key ? session : null;
}
