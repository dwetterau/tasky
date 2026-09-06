import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ToastProvider } from "react-native-toast-notifications";
import { Provider as PaperProvider } from "react-native-paper";
import { iosHeaderScreenOptions } from "@/lib/headerItems";
import { TaskyAuthProvider } from "@/lib/tasky";

export default function RootLayout() {
  return (
    <TaskyAuthProvider>
      <GestureHandlerRootView>
        <SafeAreaProvider>
          <PaperProvider>
            <ToastProvider>
              <Stack screenOptions={iosHeaderScreenOptions}>
                <Stack.Screen name="index" options={{ title: "" }} />
                <Stack.Screen
                  name="settings_page"
                  options={{ title: "Settings" }}
                />
                <Stack.Screen
                  name="tasky_captures_page"
                  options={{ title: "Tasky" }}
                />
                <Stack.Screen
                  name="portfolio_page"
                  options={{ title: "Portfolio" }}
                />
                <Stack.Screen
                  name="signals_page"
                  options={{ title: "Signals" }}
                />
                <Stack.Screen
                  name="scorecards_page"
                  options={{ title: "Scorecards" }}
                />
                <Stack.Screen
                  name="scorecard_page"
                  options={{ title: "Scorecard" }}
                />
                <Stack.Screen
                  name="scorecard_edit_page"
                  options={({ route }) => ({
                    title: (
                      route.params as { scorecardId?: string } | undefined
                    )?.scorecardId
                      ? "Edit Scorecard"
                      : "New Scorecard",
                  })}
                />
                <Stack.Screen
                  name="signal_edit_page"
                  options={({ route }) => ({
                    title: (
                      route.params as { signalId?: string } | undefined
                    )?.signalId
                      ? "Edit Signal"
                      : "New Signal",
                  })}
                />
                <Stack.Screen
                  name="signal_history_page"
                  options={{ title: "Signal" }}
                />
              </Stack>
            </ToastProvider>
          </PaperProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </TaskyAuthProvider>
  );
}
