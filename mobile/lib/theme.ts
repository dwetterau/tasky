import { PlatformColor, StyleSheet } from "react-native";

/**
 * Shared design tokens used by the React Native client to keep
 * surface-level UI consistent across home, signals, scorecards,
 * captures, portfolio, and settings.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const fontSize = {
  micro: 11,
  caption: 12,
  small: 13,
  body: 15,
  bodyLg: 16,
  subhead: 17,
  heading: 20,
  title: 28,
  display: 34,
} as const;

export const colors = {
  label: PlatformColor("label"),
  secondaryLabel: PlatformColor("secondaryLabel"),
  tertiaryLabel: PlatformColor("tertiaryLabel"),
  quaternaryLabel: PlatformColor("quaternaryLabel"),
  separator: PlatformColor("separator"),
  opaqueSeparator: PlatformColor("opaqueSeparator"),
  systemBackground: PlatformColor("systemBackground"),
  secondarySystemBackground: PlatformColor("secondarySystemBackground"),
  tertiarySystemBackground: PlatformColor("tertiarySystemBackground"),
  systemGroupedBackground: PlatformColor("systemGroupedBackground"),
  secondarySystemGroupedBackground: PlatformColor(
    "secondarySystemGroupedBackground",
  ),
  tertiarySystemGroupedBackground: PlatformColor(
    "tertiarySystemGroupedBackground",
  ),
  systemBlue: PlatformColor("systemBlue"),
  systemGreen: PlatformColor("systemGreen"),
  systemRed: PlatformColor("systemRed"),
  systemOrange: PlatformColor("systemOrange"),
  systemYellow: PlatformColor("systemYellow"),
  systemPurple: PlatformColor("systemPurple"),
  systemTeal: PlatformColor("systemTeal"),
  systemGray: PlatformColor("systemGray"),
} as const;

/**
 * Common reusable styles shared by Tasky-backed screens. Screens still
 * declare their own page-specific styles, but pulling these out keeps
 * spacing + typography aligned.
 */
export const sharedStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.systemGroupedBackground,
  },
  screenContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.caption,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: colors.secondaryLabel,
    textTransform: "uppercase",
    paddingHorizontal: spacing.xs,
  },
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardCompact: {
    borderRadius: radius.lg,
    backgroundColor: colors.secondarySystemGroupedBackground,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  inlineLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  error: {
    fontSize: fontSize.small,
    color: colors.systemRed,
  },
  muted: {
    fontSize: fontSize.small,
    color: colors.secondaryLabel,
  },
});

export function tone(value: number) {
  if (value > 0) return colors.systemGreen;
  if (value < 0) return colors.systemRed;
  return colors.secondaryLabel;
}
