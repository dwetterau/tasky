import { type Href, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { PillButton } from "@/components/PillButton";
import { automaticKeyboardInsets } from "@/lib/headerItems";
import { getSignalPeriodBounds, SIGNAL_SOON_WINDOW_MS, useSignalClock } from "@/lib/signals";
import { taskyApi, useTaskyAuth, useTaskyMutation, useTaskyQuery } from "@/lib/tasky";
import { colors, fontSize, radius, sharedStyles, spacing } from "@/lib/theme";
import { useYunmaiScale } from "@/lib/useYunmaiScale";
import { weightInPounds } from "@/lib/yunmaiProtocol";

export default function ScalePage() {
  const router = useRouter();
  const scale = useYunmaiScale();
  const auth = useTaskyAuth();
  const now = useSignalClock();
  const enabled = auth.isAuthenticated && auth.convexAuthenticated;
  const signals = useTaskyQuery(taskyApi.signals.listDashboard, enabled ? {
    now, soonWindowMs: SIGNAL_SOON_WINDOW_MS, periodBounds: getSignalPeriodBounds(now),
  } : "skip");
  const matches = signals.data?.filter(signal => signal.name === "Weight") ?? [];
  const signal = matches.length === 1 ? matches[0] : undefined;
  const compatible = signal?.model.kind === "activity" && signal.model.measurementFields?.length === 1 && signal.model.measurementFields[0] === "weight";
  const record = useTaskyMutation(taskyApi.signals.record);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = ["scanning", "connecting", "connected"].includes(scale.state);
  const saved = scale.reading !== null && savedKey === scale.reading.key;
  const readingInProgress = scale.state === "connected" && !scale.reading?.final;
  const setupMessage = compatible ? null : !enabled ? "Sign in to Tasky in Settings to save your weight." : signals.isLoading ? "Finding your Weight signal…" : matches.length > 1 ? "More than one signal is named Weight. Give them distinct names to select the destination." : signal ? "Weight must be an activity signal with only the Weight measurement enabled." : "No Weight signal found in this Tasky account.";
  const connectChoices = scale.state === "scanning"
    ? scale.devices.filter(device => device.id !== scale.lastDeviceId)
    : [];

  async function save() {
    const reading = scale.reading;
    if (!reading?.final || !signal || !compatible || !enabled || savingRef.current || saved) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await record({
        signalId: signal.id,
        idempotencyKey: reading.key,
        operation: { type: "activity.occurred", occurredAt: reading.receivedAt,
          measurements: { weight: weightInPounds(reading.kg) }, note: "YUNMAI Mini Bluetooth weigh-in" },
        soonWindowMs: SIGNAL_SOON_WINDOW_MS,
        periodBounds: getSignalPeriodBounds(Date.now()),
      });
      if (result === null) throw new Error("Sign in to Tasky, then retry saving this reading.");
      setSavedKey(reading.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Keep this screen open and retry.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.screenContent} {...automaticKeyboardInsets}>
      <View style={sharedStyles.card}>
        <View style={styles.titleRow}>
          <View
            accessibilityLabel={scale.state === "connected" ? "Connected" : "Not connected"}
            style={[styles.statusDot, scale.state === "connected" ? styles.statusDotConnected : styles.statusDotIdle]}
          />
          <Text style={styles.title}>YUNMAI Mini</Text>
        </View>
        {!scale.available ? <Text style={sharedStyles.error}>Bluetooth needs a rebuilt Tasky app on a physical iPhone. It is unavailable in Expo Go and the simulator.</Text> : null}
        <Text accessibilityLiveRegion="polite" style={scale.state === "error" ? sharedStyles.error : styles.body}>{scale.message}</Text>
        <PillButton label={busy ? "Stop" : "Connect"} disabled={!scale.available || saving} onPress={() => void (busy ? scale.stop() : scale.scan())} />
        {connectChoices.map(device => <PillButton key={device.id} label={`Connect to ${device.name}`} onPress={() => void scale.connect(device.id)} />)}
      </View>
      <View style={sharedStyles.card}>
        <Text style={sharedStyles.sectionTitle}>{scale.reading?.final ? "Completed reading" : "Live weight"}</Text>
        <Text style={styles.weight}>{scale.reading ? `${weightInPounds(scale.reading.kg).toFixed(2)} lb` : "—"}</Text>
        {scale.reading && <Text style={sharedStyles.muted}>{scale.reading.kg.toFixed(2)} kg · {new Date(scale.reading.receivedAt).toLocaleTimeString()}</Text>}
        {setupMessage && <Text style={styles.body}>{setupMessage}</Text>}
        {signals.error && <Text style={sharedStyles.error}>{signals.error}</Text>}
        {error && <Text style={sharedStyles.error}>{error}</Text>}
        <PillButton variant="primary" label={saved ? "Saved" : "Save"} loading={saving || readingInProgress} disabled={!scale.reading?.final || !compatible || !enabled || saved} onPress={() => void save()} />
        {signal && <PillButton label="View Weight history" disabled={saving} onPress={() => router.push({ pathname: "/signal_history_page", params: { signalId: signal.id } } as Href)} />}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { color: colors.label, fontSize: fontSize.heading, fontWeight: "700" },
  body: { color: colors.label, fontSize: fontSize.body },
  weight: { color: colors.label, fontSize: 44, fontWeight: "600", fontVariant: ["tabular-nums"] },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill },
  statusDotConnected: { backgroundColor: colors.systemGreen },
  statusDotIdle: { backgroundColor: colors.systemGray },
});
