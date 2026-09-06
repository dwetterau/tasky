import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  ACTIVITY_MEASUREMENT_OPTIONS,
  type ActivityMeasurementDraft,
  type ActivityMeasurementField,
} from "@/lib/signals";
import { colors, fontSize, radius, spacing } from "@/lib/theme";

export function ActivityMeasurementsForm({
  fields,
  value,
  onChange,
  disabled = false,
}: {
  fields: ActivityMeasurementField[];
  value: ActivityMeasurementDraft;
  onChange: (value: ActivityMeasurementDraft) => void;
  disabled?: boolean;
}) {
  if (fields.length === 0) {
    return null;
  }

  const options = ACTIVITY_MEASUREMENT_OPTIONS.filter((option) =>
    fields.includes(option.field),
  );

  return (
    <View style={styles.container}>
      {options.map((option) => (
        <View
          key={option.field}
          style={[styles.field, options.length === 1 && styles.fieldSolo]}
        >
          <Text style={styles.label}>{option.inputLabel}</Text>
          <TextInput
            style={[styles.input, disabled && styles.disabledInput]}
            value={value[option.field]}
            onChangeText={(nextValue) =>
              onChange({ ...value, [option.field]: nextValue })
            }
            placeholder={option.placeholder}
            placeholderTextColor={colors.tertiaryLabel}
            keyboardType={
              option.field === "reps" || option.field === "sets"
                ? "number-pad"
                : "decimal-pad"
            }
            editable={!disabled}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  field: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 140,
    gap: spacing.xs + 2,
  },
  fieldSolo: {
    flexBasis: "100%",
  },
  label: {
    color: colors.secondaryLabel,
    fontSize: fontSize.small,
    fontWeight: "600",
  },
  input: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tertiarySystemGroupedBackground,
    color: colors.label,
    fontSize: fontSize.body,
  },
  disabledInput: {
    color: colors.secondaryLabel,
    opacity: 0.6,
  },
});
