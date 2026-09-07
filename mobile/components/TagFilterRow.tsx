import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  sortTaskyTags,
  taskyTagPath,
  type TaskyTag,
  type TaskyTagId,
} from "@/lib/taskyTags";
import { colors, fontSize, radius, spacing } from "@/lib/theme";
import { useMemo } from "react";

export function TagFilterRow({
  tags,
  selectedTagId,
  onChange,
}: {
  tags: TaskyTag[];
  selectedTagId: TaskyTagId | null;
  onChange: (tagId: TaskyTagId | null) => void;
}) {
  const orderedTags = useMemo(() => sortTaskyTags(tags), [tags]);
  const tagsById = useMemo(
    () => new Map(tags.map((tag) => [String(tag._id), tag] as const)),
    [tags],
  );

  if (orderedTags.length === 0) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterRow}
    >
      <TouchableOpacity
        style={[
          styles.filterChip,
          selectedTagId === null && styles.filterChipSelected,
        ]}
        onPress={() => onChange(null)}
      >
        <Text
          style={[
            styles.filterChipText,
            selectedTagId === null && styles.filterChipTextSelected,
          ]}
        >
          All
        </Text>
      </TouchableOpacity>
      {orderedTags.map((tag) => {
        const selected = selectedTagId === tag._id;
        return (
          <TouchableOpacity
            key={tag._id}
            style={[styles.filterChip, selected && styles.filterChipSelected]}
            onPress={() => onChange(tag._id)}
          >
            <View
              style={[
                styles.filterDot,
                { backgroundColor: tag.color ?? colors.systemGray },
              ]}
            />
            <Text
              style={[
                styles.filterChipText,
                selected && styles.filterChipTextSelected,
              ]}
            >
              {taskyTagPath(tag, tagsById)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.secondarySystemGroupedBackground,
  },
  filterChipSelected: {
    backgroundColor: colors.systemBlue,
  },
  filterDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  filterChipText: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
    fontWeight: "600",
  },
  filterChipTextSelected: {
    color: "white",
  },
});
