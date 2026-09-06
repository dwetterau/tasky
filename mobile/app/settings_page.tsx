import Constants from "expo-constants";
import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTaskyAuth } from "@/lib/tasky";
import { colors, fontSize, radius, sharedStyles, spacing } from "@/lib/theme";
import { automaticKeyboardInsets } from "@/lib/headerItems";

type AccountStatus = "connected" | "disconnected" | "loading";

function statusTone(status: AccountStatus) {
  switch (status) {
    case "connected":
      return colors.systemGreen;
    case "disconnected":
      return colors.systemRed;
    case "loading":
      return colors.secondaryLabel;
  }
}

function StatusDot({ status }: { status: AccountStatus }) {
  return (
    <View
      style={[
        styles.statusDot,
        { backgroundColor: statusTone(status) as unknown as string },
      ]}
    />
  );
}

function AccountRow({
  title,
  subtitle,
  status,
  detail,
  actionLabel,
  onPressAction,
  actionDisabled,
  destructive,
  error,
}: {
  title: string;
  subtitle?: string | null;
  status: AccountStatus;
  detail?: string | null;
  actionLabel: string;
  onPressAction: () => void;
  actionDisabled?: boolean;
  destructive?: boolean;
  error?: string | null;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <View style={styles.rowHeader}>
          <View style={styles.rowTitleGroup}>
            <StatusDot status={status} />
            <Text style={styles.rowTitle}>{title}</Text>
          </View>
          <TouchableOpacity
            onPress={onPressAction}
            disabled={actionDisabled}
            hitSlop={8}
          >
            <Text
              style={[
                styles.rowAction,
                destructive ? styles.rowActionDestructive : undefined,
                actionDisabled ? styles.rowActionDisabled : undefined,
              ]}
            >
              {actionLabel}
            </Text>
          </TouchableOpacity>
        </View>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
        {error ? <Text style={sharedStyles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={sharedStyles.sectionTitle}>{title}</Text>;
}

export default function SettingsPage() {
  const taskyAuth = useTaskyAuth();

  const [isConnectingTasky, setIsConnectingTasky] = useState(false);
  const [isDisconnectingTasky, setIsDisconnectingTasky] = useState(false);
  const [taskyError, setTaskyError] = useState<string | null>(null);

  const backendEnv =
    (Constants.expoConfig?.extra as { BACKEND_ENV?: string } | undefined)
      ?.BACKEND_ENV ?? "development";
  const taskyDeployment =
    (
      Constants.expoConfig?.extra as
        | { EXPO_PUBLIC_TASKY_CONVEX_URL?: string }
        | undefined
    )?.EXPO_PUBLIC_TASKY_CONVEX_URL?.replace("https://", "").replace(
      ".convex.cloud",
      "",
    ) ?? null;

  const taskyStatus: AccountStatus = taskyAuth.isPending
    ? "loading"
    : taskyAuth.isAuthenticated && taskyAuth.convexAuthenticated
      ? "connected"
      : taskyAuth.isAuthenticated
        ? "loading"
        : "disconnected";

  const handleConnectTasky = async () => {
    setIsConnectingTasky(true);
    setTaskyError(null);
    try {
      await taskyAuth.connect();
    } catch (error) {
      setTaskyError(
        error instanceof Error ? error.message : "Failed to connect Tasky",
      );
    } finally {
      setIsConnectingTasky(false);
    }
  };

  const handleDisconnectTasky = async () => {
    setIsDisconnectingTasky(true);
    setTaskyError(null);
    try {
      await taskyAuth.disconnect();
    } catch (error) {
      setTaskyError(
        error instanceof Error ? error.message : "Failed to disconnect Tasky",
      );
    } finally {
      setIsDisconnectingTasky(false);
    }
  };

  const taskyActionLabel = !taskyAuth.isAuthenticated
    ? isConnectingTasky
      ? "Connecting…"
      : "Connect"
    : isDisconnectingTasky
      ? "Disconnecting…"
      : "Sign out";

  return (
    <ScrollView
      style={sharedStyles.screen}
      contentContainerStyle={sharedStyles.screenContent}
      {...automaticKeyboardInsets}
    >
      <SectionHeader title="Account" />
      <View style={styles.card}>
        <AccountRow
          title="Tasky"
          subtitle={
            taskyAuth.userEmail ??
            taskyAuth.userName ??
            (taskyAuth.isAuthenticated ? "Signed in" : "Not connected")
          }
          status={taskyStatus}
          detail={
            taskyDeployment
              ? `Convex · ${backendEnv} (${taskyDeployment})`
              : `Convex · ${backendEnv}`
          }
          actionLabel={taskyActionLabel}
          onPressAction={() =>
            void (taskyAuth.isAuthenticated
              ? handleDisconnectTasky()
              : handleConnectTasky())
          }
          actionDisabled={
            isConnectingTasky || isDisconnectingTasky || taskyAuth.isPending
          }
          destructive={taskyAuth.isAuthenticated}
          error={taskyError ?? taskyAuth.error}
        />
        {taskyAuth.isAuthenticated && !taskyAuth.convexAuthenticated ? (
          <View style={sharedStyles.inlineLoading}>
            <ActivityIndicator />
            <Text style={sharedStyles.muted}>Refreshing Tasky session…</Text>
          </View>
        ) : null}
      </View>

      <SectionHeader title="About" />
      <View style={styles.card}>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Build</Text>
          <Text style={styles.metaValue}>
            {Constants.expoConfig?.version ?? "dev"} · {backendEnv}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>App scheme</Text>
          <Text style={styles.metaValue}>
            {Array.isArray(Constants.expoConfig?.scheme)
              ? Constants.expoConfig?.scheme[0]
              : (Constants.expoConfig?.scheme ?? "myapp")}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
  },
  rowMain: {
    flex: 1,
    gap: spacing.xs,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  rowTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
  },
  rowTitle: {
    fontSize: fontSize.subhead,
    fontWeight: "700",
    color: colors.label,
  },
  rowSubtitle: {
    fontSize: fontSize.body,
    color: colors.label,
  },
  rowDetail: {
    fontSize: fontSize.caption,
    color: colors.secondaryLabel,
  },
  rowAction: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: colors.systemBlue,
  },
  rowActionDestructive: {
    color: colors.systemRed,
  },
  rowActionDisabled: {
    color: colors.tertiaryLabel,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  metaLabel: {
    fontSize: fontSize.body,
    color: colors.secondaryLabel,
  },
  metaValue: {
    fontSize: fontSize.body,
    color: colors.label,
    fontWeight: "600",
  },
});
