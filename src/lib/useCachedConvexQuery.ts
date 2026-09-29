"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

type CacheEntry = {
  value: unknown;
  cachedAt: number;
};

const recentValues = new Map<string, CacheEntry>();
const cacheListeners = new Set<() => void>();

function readRecentValue<Value>(key: string): Value | undefined {
  return recentValues.get(key)?.value as Value | undefined;
}

function notifyCacheListeners(): void {
  for (const listener of cacheListeners) listener();
}

function writeRecentValue<Value>(key: string, value: Value): void {
  recentValues.delete(key);
  const entry = { value, cachedAt: Date.now() };
  recentValues.set(key, entry);
  if (recentValues.size > CACHE_MAX_ENTRIES) {
    const oldestKey = recentValues.keys().next().value;
    if (oldestKey !== undefined) recentValues.delete(oldestKey);
  }
  notifyCacheListeners();
  window.setTimeout(() => {
    if (recentValues.get(key)?.cachedAt !== entry.cachedAt) return;
    recentValues.delete(key);
    notifyCacheListeners();
  }, CACHE_TTL_MS);
}

export function useRecentValue<Value>(
  cacheKey: string,
  value: Value | undefined,
): Value | undefined {
  const subscribe = useCallback((listener: () => void) => {
    cacheListeners.add(listener);
    return () => cacheListeners.delete(listener);
  }, []);
  const getSnapshot = useCallback(
    () => readRecentValue<Value>(cacheKey),
    [cacheKey],
  );
  const cachedValue = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => undefined,
  );

  useEffect(() => {
    if (value === undefined) return;
    writeRecentValue(cacheKey, value);
  }, [cacheKey, value]);

  if (value !== undefined) return value;
  return cachedValue;
}

export function useCachedConvexQuery<
  Query extends FunctionReference<"query">,
>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
  cacheKey: string,
): FunctionReturnType<Query> | undefined {
  const value = useQuery(query, args);
  return useRecentValue(cacheKey, value);
}
