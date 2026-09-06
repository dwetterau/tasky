import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, fontSize, radius } from "@/lib/theme";

type PillButtonVariant = "primary" | "tinted" | "plain" | "destructive";
type PillButtonSize = "sm" | "md";

/**
 * Capsule button with a fixed height and centered, single-line label.
 * Centralizes button rendering so alignment and sizing stay consistent
 * (padding-based buttons drifted vertically on iOS with platform fonts).
 */
export function PillButton({
  label,
  onPress,
  variant = "tinted",
  size = "md",
  disabled = false,
  loading = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: PillButtonVariant;
  size?: PillButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={isDisabled}
      hitSlop={size === "sm" ? 6 : 0}
      style={({ pressed }) => [
        styles.base,
        size === "sm" ? styles.sizeSm : styles.sizeMd,
        variantStyles[variant],
        pressed && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? "white" : undefined}
        />
      ) : (
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            size === "sm" && styles.labelSm,
            labelStyles[variant],
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  sizeSm: {
    height: 32,
    minWidth: 64,
    paddingHorizontal: 14,
  },
  sizeMd: {
    height: 46,
    paddingHorizontal: 20,
  },
  label: {
    fontSize: fontSize.body,
    fontWeight: "600",
  },
  labelSm: {
    fontSize: fontSize.small,
  },
  pressed: {
    opacity: 0.55,
  },
  disabled: {
    opacity: 0.4,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.systemBlue,
  },
  tinted: {
    backgroundColor: colors.tertiarySystemGroupedBackground,
  },
  plain: {},
  destructive: {},
});

const labelStyles = StyleSheet.create({
  primary: {
    color: "white",
  },
  tinted: {
    color: colors.systemBlue,
  },
  plain: {
    color: colors.systemBlue,
  },
  destructive: {
    color: colors.systemRed,
  },
});
