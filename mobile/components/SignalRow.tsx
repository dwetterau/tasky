import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ColorValue,
} from "react-native";
import { PillButton } from "@/components/PillButton";
import {
  signalPrimaryText,
  signalSecondaryText,
  type SignalDashboardItem,
} from "@/lib/signals";
import { colors, fontSize, radius, spacing } from "@/lib/theme";

type SignalAttention = SignalDashboardItem["evaluation"]["attention"];

export function signalAttentionColor(attention: SignalAttention): ColorValue {
  switch (attention) {
    case "due":
      return colors.systemOrange;
    case "soon":
      return colors.systemBlue;
    case "unknown":
      return colors.systemGray;
    case "ok":
      return colors.systemGreen;
  }
}

export function SignalRow({
  signal,
  now,
  onPress,
  onQuickAction,
  quickActionLabel,
  isSaving,
  compact = false,
  showsDisclosure = true,
}: {
  signal: SignalDashboardItem;
  now: number;
  onPress: () => void;
  onQuickAction?: () => void;
  quickActionLabel?: string;
  isSaving?: boolean;
  compact?: boolean;
  showsDisclosure?: boolean;
}) {
  const attentionColor = signalAttentionColor(signal.evaluation.attention);
  const detail = [
    signalPrimaryText(signal, now),
    signalSecondaryText(signal, now),
  ]
    .filter(Boolean)
    .join(" · ");
  const firstTag = signal.tags[0];

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <TouchableOpacity
        style={styles.main}
        activeOpacity={0.6}
        onPress={onPress}
      >
        <Text style={styles.title} numberOfLines={1}>
          {signal.name}
        </Text>
        <View style={styles.detailRow}>
          <View
            style={[styles.statusDot, { backgroundColor: attentionColor }]}
          />
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
            {firstTag ? (
              <Text style={styles.detailTag}>{`  ·  ${firstTag.name}`}</Text>
            ) : null}
          </Text>
        </View>
      </TouchableOpacity>
      {onQuickAction && quickActionLabel ? (
        <PillButton
          size="sm"
          variant="tinted"
          label={quickActionLabel}
          onPress={onQuickAction}
          loading={isSaving}
        />
      ) : showsDisclosure ? (
        <Text style={styles.chevron}>{"›"}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowCompact: {
    minHeight: 52,
    paddingHorizontal: 0,
  },
  main: {
    flex: 1,
    gap: 3,
  },
  title: {
    color: colors.label,
    fontSize: fontSize.body,
    fontWeight: "600",
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
  },
  detail: {
    flex: 1,
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
    fontVariant: ["tabular-nums"],
  },
  detailTag: {
    color: colors.tertiaryLabel,
  },
  chevron: {
    color: colors.tertiaryLabel,
    fontSize: 22,
    fontWeight: "300",
  },
});
