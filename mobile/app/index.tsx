import { useNavigation } from "expo-router";
import { useCallback, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { colors, fontSize, radius, spacing } from "@/lib/theme";
import { useTaskyAuth } from "@/lib/tasky";
import HomePage from "./home_page";
import LoadingScreen from "./loading_screen";

function LoginScreen() {
  const taskyAuth = useTaskyAuth();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const handleLogin = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      await taskyAuth.connect();
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : "Failed to log in",
      );
    } finally {
      setIsBusy(false);
    }
  }, [taskyAuth]);

  return (
    <View style={styles.loginContainer}>
      <View style={styles.loginContent}>
        <Text style={styles.loginTitle}>Dailies</Text>
        <Text style={styles.loginSubtitle}>
          A single home for your daily activities, tasks, and portfolio.
        </Text>
        <TouchableOpacity
          style={[styles.primaryButton, isBusy && styles.primaryButtonDisabled]}
          onPress={() => void handleLogin()}
          disabled={isBusy}
        >
          {isBusy ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.primaryButtonText}>Log in with Tasky</Text>
          )}
        </TouchableOpacity>
        {error || taskyAuth.error ? (
          <Text style={styles.loginError}>{error ?? taskyAuth.error}</Text>
        ) : null}
      </View>
    </View>
  );
}

function AuthenticatedHome() {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);
  return <HomePage />;
}

export default function Index() {
  const taskyAuth = useTaskyAuth();

  if (taskyAuth.isPending) {
    return <LoadingScreen message="Logging in..." />;
  }

  if (taskyAuth.isAuthenticated) {
    return <AuthenticatedHome />;
  }

  return <LoginScreen />;
}

const styles = StyleSheet.create({
  loginContainer: {
    flex: 1,
    backgroundColor: colors.systemGroupedBackground,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  loginContent: {
    gap: spacing.lg,
    alignItems: "center",
  },
  loginTitle: {
    fontSize: 44,
    fontWeight: "800",
    color: colors.label,
  },
  loginSubtitle: {
    fontSize: fontSize.body,
    color: colors.secondaryLabel,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  primaryButton: {
    minWidth: 200,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.systemBlue,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: "white",
    fontSize: fontSize.bodyLg,
    fontWeight: "700",
  },
  loginError: {
    color: colors.systemRed,
    fontSize: fontSize.small,
    textAlign: "center",
  },
});
