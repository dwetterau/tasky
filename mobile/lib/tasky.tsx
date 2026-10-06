import { expoClient } from "@better-auth/expo/client";
import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import {
  ConvexBetterAuthProvider,
  type AuthClient as ConvexBetterAuthClient,
} from "@convex-dev/better-auth/react";
import { api as taskyApi } from "tasky-convex/_generated/api";
import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth/client";
import {
  ConvexProviderWithAuth,
  ConvexReactClient,
  useConvexAuth,
} from "convex/react";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { getFunctionName } from "convex/server";
import Constants from "expo-constants";
import * as ExpoWebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import {
  isRetryableTaskyTokenError,
  shouldRestartTaskyAuthOnForeground,
  taskyAuthRetryDelay,
} from "./taskyAuthRecovery";

const APP_SCHEME = "tasky";

// Release builds must statically import this so Metro bundles it for
// @better-auth/expo's dynamic import() during OAuth.
void ExpoWebBrowser.openAuthSessionAsync;

type TaskyExtraConfig = {
  EXPO_PUBLIC_TASKY_CONVEX_URL?: string;
  EXPO_PUBLIC_TASKY_CONVEX_SITE_URL?: string;
};

const taskyExtra = (Constants.expoConfig?.extra ?? {}) as TaskyExtraConfig;
const taskyConvexUrl = taskyExtra.EXPO_PUBLIC_TASKY_CONVEX_URL;
const taskyConvexSiteUrl = taskyExtra.EXPO_PUBLIC_TASKY_CONVEX_SITE_URL;
const configuredScheme = Array.isArray(Constants.expoConfig?.scheme)
  ? Constants.expoConfig?.scheme[0]
  : Constants.expoConfig?.scheme;
const appScheme = configuredScheme ?? APP_SCHEME;
const taskyNativeOrigin = `${appScheme}://`;

const secureStore = {
  getItem: (key: string) => SecureStore.getItem(key),
  setItem: (key: string, value: string) => SecureStore.setItem(key, value),
};

const nativeOriginClient = (origin: string) => ({
  id: "tasky-native-origin",
  fetchPlugins: [
    {
      id: "tasky-native-origin",
      name: "Tasky Native Origin",
      hooks: {
        onRequest: (context) => {
          const headers = new Headers(context.headers);
          headers.set("Origin", origin);
          headers.set("expo-origin", origin);
          return {
            ...context,
            headers,
          };
        },
      },
    },
  ],
}) satisfies BetterAuthClientPlugin;

export const taskyAuthClient =
  Platform.OS === "web"
    ? createAuthClient({
        baseURL: taskyConvexSiteUrl,
        plugins: [
          convexClient(),
          crossDomainClient({ storagePrefix: "tasky" }),
        ],
      })
    : createAuthClient({
        baseURL: taskyConvexSiteUrl,
        plugins: [
          convexClient(),
          expoClient({
            scheme: appScheme,
            storagePrefix: "tasky",
            storage: secureStore,
          }),
          nativeOriginClient(taskyNativeOrigin),
        ],
      });

// The provider only uses useSession() and convex.token(), which this client has.
// Its published AuthClient type does not account for @better-auth/expo plugins.
const taskyProviderAuthClient =
  taskyAuthClient as unknown as ConvexBetterAuthClient;

export const taskyConvex = taskyConvexUrl
  ? new ConvexReactClient(taskyConvexUrl, {
      unsavedChangesWarning: false,
    })
  : null;

// The stock adapter treats a transient token request failure as signed out and
// only restarts Convex auth when the Better Auth session ID changes. A sleeping
// native app can therefore stay unauthenticated forever with a valid session.
// Give native clients a new fetcher identity on resume/failure so setAuth retries.
function useRecoveringTaskyConvexAuth() {
  const {
    data: session,
    isPending: isSessionPending,
    refetch: refetchSession,
  } = taskyAuthClient.useSession();
  const sessionId = session?.session?.id;

  const cachedTokenRef = useRef<string | null>(null);
  const cachedTokenSessionIdRef = useRef<string | undefined>(undefined);
  const pendingTokenRef = useRef<{
    sessionId: string | undefined;
    promise: Promise<string | null>;
  } | null>(null);
  const previousSessionIdRef = useRef(sessionId);
  const tokenEpochRef = useRef(0);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backgroundedAtRef = useRef<number | null>(null);
  const previousAppStateRef = useRef(AppState.currentState);
  const mountedRef = useRef(false);
  const [authCycle, setAuthCycle] = useState(0);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const restartAuth = useCallback(() => {
    clearRetryTimer();
    tokenEpochRef.current += 1;
    pendingTokenRef.current = null;
    cachedTokenRef.current = null;
    cachedTokenSessionIdRef.current = undefined;
    setAuthCycle((current) => current + 1);
  }, [clearRetryTimer]);

  const scheduleRetry = useCallback(
    (tokenEpoch: number) => {
      if (
        tokenEpoch !== tokenEpochRef.current ||
        retryTimerRef.current !== null
      ) {
        return;
      }

      const delay = taskyAuthRetryDelay(retryAttemptRef.current);
      retryAttemptRef.current += 1;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (
          mountedRef.current &&
          sessionId &&
          AppState.currentState === "active"
        ) {
          restartAuth();
        }
      }, delay);
    },
    [restartAuth, sessionId],
  );

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = previousAppStateRef.current;
      previousAppStateRef.current = nextState;

      if (nextState !== "active") {
        if (previousState === "active") {
          backgroundedAtRef.current = Date.now();
        }
        return;
      }

      if (
        previousState !== "active" &&
        shouldRestartTaskyAuthOnForeground({
          hasSession: Boolean(sessionId),
          hasCachedToken: cachedTokenRef.current !== null,
          backgroundedAt: backgroundedAtRef.current,
          now: Date.now(),
        })
      ) {
        restartAuth();
      }
      backgroundedAtRef.current = null;
    });

    return () => subscription.remove();
  }, [restartAuth, sessionId]);

  useLayoutEffect(() => {
    if (previousSessionIdRef.current !== sessionId) {
      previousSessionIdRef.current = sessionId;
      clearRetryTimer();
      tokenEpochRef.current += 1;
      pendingTokenRef.current = null;
      cachedTokenRef.current = null;
      cachedTokenSessionIdRef.current = undefined;
      retryAttemptRef.current = 0;
    }
  }, [clearRetryTimer, sessionId]);

  const fetchAccessToken = useCallback(
    async ({
      forceRefreshToken = false,
    }: {
      forceRefreshToken?: boolean;
    } = {}): Promise<string | null> => {
      void authCycle;
      if (
        cachedTokenRef.current &&
        cachedTokenSessionIdRef.current === sessionId &&
        !forceRefreshToken
      ) {
        return cachedTokenRef.current;
      }
      const pendingToken = pendingTokenRef.current;
      if (
        !forceRefreshToken &&
        pendingToken &&
        pendingToken.sessionId === sessionId
      ) {
        return await pendingToken.promise;
      }

      const tokenEpoch = tokenEpochRef.current;
      const request = taskyAuthClient.convex
        .token({ fetchOptions: { throw: false } })
        .then(({ data, error }) => {
          const token = data?.token || null;
          const isCurrentRequest =
            mountedRef.current &&
            tokenEpoch === tokenEpochRef.current &&
            sessionId === previousSessionIdRef.current;
          if (isCurrentRequest) {
            cachedTokenRef.current = token;
            cachedTokenSessionIdRef.current = token ? sessionId : undefined;
            if (token) {
              clearRetryTimer();
              retryAttemptRef.current = 0;
            } else if (isRetryableTaskyTokenError(error)) {
              scheduleRetry(tokenEpoch);
            } else {
              void refetchSession();
            }
          }
          return isCurrentRequest ? token : null;
        })
        .catch(() => {
          if (
            mountedRef.current &&
            tokenEpoch === tokenEpochRef.current &&
            sessionId === previousSessionIdRef.current
          ) {
            cachedTokenRef.current = null;
            cachedTokenSessionIdRef.current = undefined;
            scheduleRetry(tokenEpoch);
          }
          return null;
        })
        .finally(() => {
          if (pendingTokenRef.current?.promise === request) {
            pendingTokenRef.current = null;
          }
        });
      pendingTokenRef.current = { sessionId, promise: request };
      return await request;
    },
    [authCycle, clearRetryTimer, refetchSession, scheduleRetry, sessionId],
  );

  return useMemo(
    () => ({
      isLoading: isSessionPending,
      isAuthenticated: Boolean(session?.session),
      fetchAccessToken,
    }),
    [fetchAccessToken, isSessionPending, session?.session],
  );
}

function RecoveringTaskyConvexProvider({ children }: { children: ReactNode }) {
  if (!taskyConvex) {
    return children;
  }

  return (
    <ConvexProviderWithAuth
      client={taskyConvex}
      useAuth={useRecoveringTaskyConvexAuth}
    >
      {children}
    </ConvexProviderWithAuth>
  );
}

const TASKY_QUERY_CACHE_TTL_MS = 5 * 60 * 1000;
const TASKY_QUERY_CACHE_MAX_ENTRIES = 100;

type TaskyQueryCacheEntry = {
  data: unknown;
  cachedAt: number;
};

const taskyQueryCache = new Map<string, TaskyQueryCacheEntry>();

function stableQueryArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(
      ([key]) => key !== "now" && key !== "periodBounds",
    ),
  );
}

function queryCacheKey(
  cacheScope: string,
  queryName: string,
  args: Record<string, unknown>,
): string {
  return `${cacheScope}:${queryName}:${JSON.stringify(stableQueryArgs(args))}`;
}

function readCachedQuery<Result>(key: string): Result | undefined {
  const cached = taskyQueryCache.get(key);
  if (!cached) {
    return undefined;
  }
  if (Date.now() - cached.cachedAt > TASKY_QUERY_CACHE_TTL_MS) {
    taskyQueryCache.delete(key);
    return undefined;
  }
  return cached.data as Result;
}

function cacheQueryResult<Result>(key: string, data: Result): void {
  taskyQueryCache.delete(key);
  taskyQueryCache.set(key, { data, cachedAt: Date.now() });
  if (taskyQueryCache.size > TASKY_QUERY_CACHE_MAX_ENTRIES) {
    const oldestKey = taskyQueryCache.keys().next().value;
    if (oldestKey !== undefined) {
      taskyQueryCache.delete(oldestKey);
    }
  }
}

function clearTaskyQueryCache(): void {
  taskyQueryCache.clear();
}

type TaskyAuthContextValue = {
  isConfigured: boolean;
  isPending: boolean;
  isAuthenticated: boolean;
  convexAuthenticated: boolean;
  cacheScope: string;
  userName: string | null;
  userEmail: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const TaskyAuthContext = createContext<TaskyAuthContextValue | null>(null);

function ConfiguredTaskyAuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending, refetch } = taskyAuthClient.useSession();
  const {
    isAuthenticated: convexAuthenticated,
    isLoading: convexAuthLoading,
  } = useConvexAuth();
  const [error, setError] = useState<string | null>(null);
  const lastUserId = useRef<string | null>(null);
  if (session?.user?.id) {
    lastUserId.current = session.user.id;
  }

  useEffect(() => {
    if (!isPending && !session && !convexAuthenticated) {
      clearTaskyQueryCache();
      lastUserId.current = null;
    }
  }, [convexAuthenticated, isPending, session]);

  useEffect(() => {
    if (!convexAuthenticated || !taskyConvex) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) {
      void taskyConvex.mutation(taskyApi.users.updateTimezone, { timezone });
    }
  }, [convexAuthenticated]);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const result = await taskyAuthClient.signIn.social({
        provider: "github",
        callbackURL: "/",
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Tasky sign-in failed");
      }
      await taskyAuthClient.getSession();
      await refetch();
    } catch (connectError) {
      const message =
        connectError instanceof Error
          ? connectError.message
          : "Tasky sign-in failed";
      setError(message);
      throw connectError;
    }
  }, [refetch]);

  const disconnect = useCallback(async () => {
    setError(null);
    await taskyAuthClient.signOut();
    await refetch();
    clearTaskyQueryCache();
  }, [refetch]);

  const value = useMemo<TaskyAuthContextValue>(
    () => ({
      isConfigured: Boolean(taskyConvexUrl && taskyConvexSiteUrl && appScheme),
      isPending:
        (isPending || convexAuthLoading) && !convexAuthenticated,
      isAuthenticated: Boolean(session?.session) || convexAuthenticated,
      convexAuthenticated,
      cacheScope: lastUserId.current ?? "authenticated",
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      error,
      connect,
      disconnect,
    }),
    [
      isPending,
      convexAuthLoading,
      session?.session,
      session?.user?.id,
      session?.user?.name,
      session?.user?.email,
      convexAuthenticated,
      error,
      connect,
      disconnect,
    ],
  );

  return (
    <TaskyAuthContext.Provider value={value}>
      {children}
    </TaskyAuthContext.Provider>
  );
}

function UnconfiguredTaskyAuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useMemo<TaskyAuthContextValue>(
    () => ({
      isConfigured: false,
      isPending: false,
      isAuthenticated: false,
      convexAuthenticated: false,
      cacheScope: "unconfigured",
      userName: null,
      userEmail: null,
      error: "Tasky Convex is not configured.",
      connect: () =>
        Promise.reject(new Error("Tasky Convex is not configured.")),
      disconnect: () => Promise.resolve(),
    }),
    [],
  );

  return (
    <TaskyAuthContext.Provider value={value}>
      {children}
    </TaskyAuthContext.Provider>
  );
}

export function TaskyAuthProvider({ children }: { children: ReactNode }) {
  if (!taskyConvex) {
    return (
      <UnconfiguredTaskyAuthProvider>
        {children}
      </UnconfiguredTaskyAuthProvider>
    );
  }

  if (Platform.OS !== "web") {
    return (
      <RecoveringTaskyConvexProvider>
        <ConfiguredTaskyAuthProvider>{children}</ConfiguredTaskyAuthProvider>
      </RecoveringTaskyConvexProvider>
    );
  }

  return (
    <ConvexBetterAuthProvider
      client={taskyConvex}
      authClient={taskyProviderAuthClient}
    >
      <ConfiguredTaskyAuthProvider>{children}</ConfiguredTaskyAuthProvider>
    </ConvexBetterAuthProvider>
  );
}

export function useTaskyAuth() {
  const context = useContext(TaskyAuthContext);
  if (!context) {
    throw new Error("useTaskyAuth must be used within TaskyAuthProvider");
  }
  return context;
}

export function useTaskyQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
): {
  data: FunctionReturnType<Query> | undefined;
  error: string | null;
  isLoading: boolean;
} {
  const { isAuthenticated, convexAuthenticated, cacheScope } = useTaskyAuth();
  const [error, setError] = useState<string | null>(null);
  const queryName = getFunctionName(query);
  const serializedArgs = JSON.stringify(args);
  const cacheKey =
    args === "skip"
      ? null
      : queryCacheKey(
          cacheScope,
          queryName,
          args as Record<string, unknown>,
        );
  const [result, setResult] = useState<{
    cacheKey: string | null;
    data: FunctionReturnType<Query> | undefined;
  }>(() => ({
    cacheKey,
    data:
      cacheKey === null
        ? undefined
        : readCachedQuery<FunctionReturnType<Query>>(cacheKey),
  }));
  const data =
    cacheKey === null
      ? undefined
      : result.cacheKey === cacheKey
        ? result.data
        : readCachedQuery<FunctionReturnType<Query>>(cacheKey);
  const canRun = Boolean(
    args !== "skip" && isAuthenticated && convexAuthenticated && taskyConvex,
  );

  useEffect(() => {
    if (!canRun || args === "skip" || !taskyConvex) {
      return;
    }

    const currentCacheKey = queryCacheKey(
      cacheScope,
      queryName,
      args as Record<string, unknown>,
    );
    setResult((current) =>
      current.cacheKey === currentCacheKey
        ? current
        : {
            cacheKey: currentCacheKey,
            data:
              readCachedQuery<FunctionReturnType<Query>>(currentCacheKey),
          },
    );
    setError(null);
    const watch = taskyConvex.watchQuery(query, args);
    const update = () => {
      try {
        const nextData = watch.localQueryResult();
        if (nextData === undefined) {
          return;
        }
        cacheQueryResult(currentCacheKey, nextData);
        setResult({ cacheKey: currentCacheKey, data: nextData });
        setError(null);
      } catch (queryError) {
        setError(
          queryError instanceof Error
            ? queryError.message
            : "Tasky query failed",
        );
      }
    };
    update();
    return watch.onUpdate(update);
    // Function references from generated APIs can have unstable object identity.
    // Use the function name plus serialized args to keep subscriptions stable.
  }, [cacheScope, queryName, serializedArgs, canRun]);

  return { data, error, isLoading: Boolean(canRun && data === undefined) };
}

export function useTaskyAction<Action extends FunctionReference<"action">>(
  actionReference: Action,
) {
  const { isAuthenticated, convexAuthenticated } = useTaskyAuth();
  const actionName = getFunctionName(actionReference);
  return useCallback(
    async (
      args: FunctionArgs<Action>,
    ): Promise<FunctionReturnType<Action> | null> => {
      if (!taskyConvex || !isAuthenticated || !convexAuthenticated) {
        return null;
      }
      return await taskyConvex.action(actionReference, args);
    },
    [actionName, isAuthenticated, convexAuthenticated],
  );
}

export function useTaskyMutation<
  Mutation extends FunctionReference<"mutation">,
>(mutationReference: Mutation) {
  const { isAuthenticated, convexAuthenticated } = useTaskyAuth();
  const mutationName = getFunctionName(mutationReference);
  return useCallback(
    async (
      args: FunctionArgs<Mutation>,
    ): Promise<FunctionReturnType<Mutation> | null> => {
      if (!taskyConvex || !isAuthenticated || !convexAuthenticated) {
        return null;
      }
      return await taskyConvex.mutation(mutationReference, args);
    },
    [mutationName, isAuthenticated, convexAuthenticated],
  );
}

export { taskyApi };
