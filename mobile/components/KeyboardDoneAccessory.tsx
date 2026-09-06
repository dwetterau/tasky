import { useEffect, useState } from "react";
import {
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { colors, fontSize, radius, spacing } from "@/lib/theme";

/**
 * Floating "Done" pill that appears just above the iOS keyboard so number
 * pads (which have no return key) always have a clear way to dismiss.
 * Rendered as an absolutely-positioned sibling of the page ScrollView.
 * (InputAccessoryView is not used because it fails to render under the
 * current expo-router / react-native-screens setup.)
 */
export function KeyboardDismissBar() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const showListener = Keyboard.addListener("keyboardWillShow", (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideListener = Keyboard.addListener("keyboardWillHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

  if (Platform.OS !== "ios" || keyboardHeight === 0) return null;

  return (
    <View
      style={[styles.container, { bottom: keyboardHeight + spacing.sm }]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={styles.button}
        onPress={() => Keyboard.dismiss()}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Dismiss keyboard"
      >
        <Text style={styles.label}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: spacing.lg,
  },
  button: {
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondarySystemGroupedBackground,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  label: {
    color: colors.systemBlue,
    fontSize: fontSize.body,
    fontWeight: "600",
  },
});
