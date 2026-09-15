import { NativeModule, requireOptionalNativeModule } from "expo";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { MMKV } from "react-native-mmkv";
import { parseYunmaiPacket, scaleEntryKey, type ScaleReading } from "./yunmaiProtocol";

type ScaleEvent =
  | { type: "status"; state: string; message: string }
  | { type: "device"; id: string; name: string; rssi: number }
  | { type: "detail"; message: string }
  | { type: "packet"; id: string; hex: string; receivedAt: number };
class ScaleNativeModule extends NativeModule<{ onScaleEvent: (event: ScaleEvent) => void }> {
  scan!: () => Promise<void>;
  connect!: (id: string) => Promise<void>;
  stop!: () => Promise<void>;
}
const native = Platform.OS === "ios" ? requireOptionalNativeModule<ScaleNativeModule>("TaskyScale") : null;
const LAST_DEVICE_KEY = "lastDeviceId";
const SESSION_IDLE_MS = 30_000;
const storage = Platform.OS === "ios" ? new MMKV({ id: "tasky-scale" }) : null;

export type CapturedReading = ScaleReading & { receivedAt: number; key: string };

export function useYunmaiScale() {
  const [state, setState] = useState("idle");
  const [message, setMessage] = useState("Keep your scale nearby.");
  const [devices, setDevices] = useState<Array<{ id: string; name: string }>>([]);
  const [reading, setReading] = useState<CapturedReading | null>(null);
  const [lastDeviceId, setLastDeviceId] = useState<string | null>(
    () => storage?.getString(LAST_DEVICE_KEY) ?? null,
  );
  const lastLive = useRef<{ timestamp: number; receivedAt: number } | null>(null);
  const accepting = useRef(false);
  const selectedId = useRef<string | null>(null);
  const lastDeviceIdRef = useRef(lastDeviceId);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoringIdleStatus = useRef(false);
  lastDeviceIdRef.current = lastDeviceId;

  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }, []);
  const reportError = useCallback((error: unknown) => {
    clearIdleTimer();
    setState("error");
    setMessage(error instanceof Error ? error.message : String(error));
  }, [clearIdleTimer]);
  const rememberDevice = useCallback((id: string) => {
    lastDeviceIdRef.current = id;
    setLastDeviceId(id);
    storage?.set(LAST_DEVICE_KEY, id);
  }, []);
  const stop = useCallback(async () => {
    clearIdleTimer();
    accepting.current = false;
    await native?.stop();
  }, [clearIdleTimer]);
  const abandon = useCallback(async () => {
    ignoringIdleStatus.current = true;
    clearIdleTimer();
    accepting.current = false;
    try { await native?.stop(); } catch { /* keep the timeout message even if BLE stop fails */ }
    setReading(current => current?.final ? current : null);
    setState("idle");
    setMessage("Weigh-in timed out. Connect again when you're ready.");
  }, [clearIdleTimer]);
  const armIdleTimer = useCallback(() => {
    clearIdleTimer();
    idleTimer.current = setTimeout(() => { void abandon(); }, SESSION_IDLE_MS);
  }, [abandon, clearIdleTimer]);
  const connect = useCallback(async (id: string) => {
    clearIdleTimer();
    accepting.current = true;
    selectedId.current = id;
    lastLive.current = null;
    rememberDevice(id);
    setState("connecting");
    try { await native?.connect(id); } catch (error) { accepting.current = false; reportError(error); }
  }, [clearIdleTimer, rememberDevice, reportError]);

  useFocusEffect(useCallback(() => {
    const listener = native?.addListener("onScaleEvent", event => {
      if (event.type === "status") {
        if (ignoringIdleStatus.current && event.state === "idle") {
          ignoringIdleStatus.current = false;
          return;
        }
        if (event.state === "connected") armIdleTimer();
        else if (event.state === "idle" || event.state === "error") clearIdleTimer();
        setState(event.state);
        setMessage(event.message);
      } else if (event.type === "device") {
        setDevices(previous => previous.some(device => device.id === event.id) ? previous : [...previous, event]);
        if (!selectedId.current && event.id === lastDeviceIdRef.current) {
          void connect(event.id);
        }
      } else if (accepting.current && event.type === "packet" && event.id === selectedId.current) {
        const parsed = parseYunmaiPacket(event.hex);
        if (!parsed) return;
        if (!parsed.final) {
          lastLive.current = { timestamp: parsed.scaleTimestamp, receivedAt: event.receivedAt };
          armIdleTimer();
        } else {
          // An old scale clock is fine; require a live reading from this session
          // so cached historical notifications cannot be saved as today's weight.
          const live = lastLive.current;
          if (!live || event.receivedAt - live.receivedAt > 45000 || Math.abs(parsed.scaleTimestamp - live.timestamp) > 45000) {
            setMessage("Step off and weigh again so we can capture a fresh reading.");
            armIdleTimer();
            return;
          }
          clearIdleTimer();
          accepting.current = false;
          void native?.stop().catch(reportError);
        }
        setReading({ ...parsed, receivedAt: event.receivedAt, key: scaleEntryKey(event.id, parsed) });
      }
    });
    const appListener = AppState.addEventListener("change", next => {
      if (next !== "active") void stop().catch(reportError);
    });
    return () => {
      clearIdleTimer();
      accepting.current = false;
      listener?.remove();
      appListener.remove();
      void native?.stop().catch(() => undefined);
    };
  }, [armIdleTimer, clearIdleTimer, connect, reportError, stop]));

  return {
    available: native !== null, state, message, devices, reading, lastDeviceId,
    scan: async () => {
      clearIdleTimer();
      ignoringIdleStatus.current = false;
      setDevices([]);
      setReading(null);
      lastLive.current = null;
      accepting.current = false;
      selectedId.current = null;
      try { await native?.scan(); } catch (error) { reportError(error); }
    },
    connect,
    stop: () => stop().catch(reportError),
  };
}
