import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  sortTaskyTags,
  taskyTagPath,
  type TaskyTag,
  type TaskyTagId,
} from "@/lib/taskyTags";
import { colors, fontSize, radius, spacing } from "@/lib/theme";

export function TaskyTagPicker({
  tags,
  selectedTagIds,
  onChange,
  isLoading = false,
}: {
  tags: TaskyTag[];
  selectedTagIds: TaskyTagId[];
  onChange: (tagIds: TaskyTagId[]) => void;
  isLoading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const orderedTags = useMemo(() => sortTaskyTags(tags), [tags]);
  const tagsById = useMemo(
    () => new Map(tags.map((tag) => [String(tag._id), tag])),
    [tags],
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const selectedTags = orderedTags.filter((tag) =>
    selectedTagIds.includes(tag._id),
  );
  const availableTags = orderedTags.filter(
    (tag) =>
      !selectedTagIds.includes(tag._id) &&
      (normalizedSearch === "" ||
        taskyTagPath(tag, tagsById)
          .toLocaleLowerCase()
          .includes(normalizedSearch)),
  );
  const showSearch = tags.length > 3;
  const collapsed = normalizedSearch === "" && !expanded;
  const visibleTags = collapsed
    ? availableTags.slice(0, Math.max(0, 3 - selectedTags.length))
    : availableTags;
  const hiddenCount = availableTags.length - visibleTags.length;

  const toggleTag = (tagId: TaskyTagId) => {
    const selected = selectedTagIds.includes(tagId);
    onChange(
      selected
        ? selectedTagIds.filter((selectedId) => selectedId !== tagId)
        : [...selectedTagIds, tagId],
    );
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Tags</Text>
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" />
        </View>
      ) : tags.length === 0 ? (
        <Text style={styles.helpText}>No Tasky tags yet.</Text>
      ) : (
        <>
          {showSearch ? (
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              placeholder="Find a tag"
              placeholderTextColor={colors.tertiaryLabel}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
            />
          ) : null}
          <View style={styles.tags}>
            {selectedTags.map((tag) => {
              const color = tag.color ?? colors.systemGray;
              return (
                <TouchableOpacity
                  key={tag._id}
                  style={[styles.tag, styles.tagSelected]}
                  onPress={() => toggleTag(tag._id)}
                  activeOpacity={0.7}
                  accessibilityLabel={`Remove ${taskyTagPath(tag, tagsById)}`}
                >
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <Text
                    style={[styles.tagText, styles.tagTextSelected]}
                    numberOfLines={1}
                  >
                    {taskyTagPath(tag, tagsById)}
                  </Text>
                  <Text style={styles.removeMark}>×</Text>
                </TouchableOpacity>
              );
            })}
            {visibleTags.map((tag) => {
              const color = tag.color ?? colors.systemGray;
              return (
                <TouchableOpacity
                  key={tag._id}
                  style={styles.tag}
                  onPress={() => toggleTag(tag._id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <Text style={styles.tagText} numberOfLines={1}>
                    {taskyTagPath(tag, tagsById)}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {hiddenCount > 0 ? (
              <TouchableOpacity
                style={styles.tag}
                onPress={() => setExpanded(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Show ${hiddenCount} more tags`}
              >
                <Text style={styles.tagText}>+{hiddenCount} more</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {selectedTags.length === 0 &&
          availableTags.length === 0 &&
          normalizedSearch !== "" ? (
            <Text style={styles.helpText}>No matching tags.</Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  label: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
    fontWeight: "600",
  },
  loading: {
    alignItems: "flex-start",
  },
  search: {
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tertiarySystemGroupedBackground,
    color: colors.label,
    fontSize: fontSize.body,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  tag: {
    maxWidth: "100%",
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiarySystemGroupedBackground,
  },
  tagSelected: {
    backgroundColor: colors.systemBlue,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  tagText: {
    flexShrink: 1,
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
    fontWeight: "600",
  },
  tagTextSelected: {
    color: "white",
  },
  removeMark: {
    color: "white",
    fontSize: fontSize.body,
    fontWeight: "600",
  },
  helpText: {
    color: colors.tertiaryLabel,
    fontSize: fontSize.caption,
  },
});
