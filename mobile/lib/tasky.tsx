import { expoClient } from "@better-auth/expo/client";
import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import { api as taskyApi } from "tasky-convex/_generated/api";
import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { ConvexReactClient } from "convex/react";
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
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";

const APP_SCHEME = "myapp";

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

export const taskyAuthClient = createAuthClient({
  baseURL: taskyConvexSiteUrl,
  plugins: [
    convexClient(),
    ...(Platform.OS === "web"
      ? [crossDomainClient({ storagePrefix: "tasky" })]
      : [
          expoClient({
            scheme: appScheme,
            storagePrefix: "tasky",
            storage: secureStore,
          }),
          nativeOriginClient(taskyNativeOrigin),
        ]),
  ],
});

export const taskyConvex = taskyConvexUrl
  ? new ConvexReactClient(taskyConvexUrl, {
      unsavedChangesWarning: false,
    })
  : null;

type TaskyAuthContextValue = {
  isConfigured: boolean;
  isPending: boolean;
  isAuthenticated: boolean;
  convexAuthenticated: boolean;
  userName: string | null;
  userEmail: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshToken: () => Promise<string | null>;
};

const TaskyAuthContext = createContext<TaskyAuthContextValue | null>(null);

export function TaskyAuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending, refetch } = taskyAuthClient.useSession();
  const [convexAuthenticated, setConvexAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingTokenRef = useRef<Promise<string | null> | null>(null);
  const sessionId = session?.session?.id ?? null;

  const refreshToken = useCallback(async () => {
    if (!taskyConvexSiteUrl) return null;
    const result = await taskyAuthClient.convex.token({
      fetchOptions: { throw: false },
    });
    return result.data?.token ?? null;
  }, []);

  useEffect(() => {
    if (!taskyConvex) return;
    taskyConvex.setAuth(
      async ({ forceRefreshToken }) => {
        if (!forceRefreshToken && pendingTokenRef.current) {
          return pendingTokenRef.current;
        }
        pendingTokenRef.current = refreshToken()
          .catch(() => null)
          .finally(() => {
            pendingTokenRef.current = null;
          });
        return pendingTokenRef.current;
      },
      (isAuthed) => {
        setConvexAuthenticated(isAuthed);
      },
    );
    return () => {
      taskyConvex.clearAuth();
      setConvexAuthenticated(false);
    };
  }, [refreshToken, sessionId]);

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
      await refreshToken();
    } catch (connectError) {
      const message =
        connectError instanceof Error
          ? connectError.message
          : "Tasky sign-in failed";
      setError(message);
      throw connectError;
    }
  }, [refetch, refreshToken]);

  const disconnect = useCallback(async () => {
    setError(null);
    await taskyAuthClient.signOut();
    await refetch();
    taskyConvex?.clearAuth();
    setConvexAuthenticated(false);
  }, [refetch]);

  const value = useMemo<TaskyAuthContextValue>(
    () => ({
      isConfigured: Boolean(taskyConvexUrl && taskyConvexSiteUrl && appScheme),
      isPending,
      isAuthenticated: Boolean(session?.session),
      convexAuthenticated,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      error,
      connect,
      disconnect,
      refreshToken,
    }),
    [
      isPending,
      session?.session,
      session?.user?.name,
      session?.user?.email,
      convexAuthenticated,
      error,
      connect,
      disconnect,
      refreshToken,
    ],
  );

  return (
    <TaskyAuthContext.Provider value={value}>
      {children}
    </TaskyAuthContext.Provider>
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
  const { isAuthenticated, convexAuthenticated } = useTaskyAuth();
  const [data, setData] = useState<FunctionReturnType<Query> | undefined>();
  const [error, setError] = useState<string | null>(null);
  const queryName = getFunctionName(query);
  const serializedArgs = JSON.stringify(args);
  const canRun = Boolean(
    args !== "skip" && isAuthenticated && convexAuthenticated && taskyConvex,
  );

  useEffect(() => {
    if (!canRun || args === "skip" || !taskyConvex) {
      setData(undefined);
      return;
    }

    const watch = taskyConvex.watchQuery(query, args);
    const update = () => {
      try {
        setData(watch.localQueryResult());
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
  }, [queryName, serializedArgs, canRun]);

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
