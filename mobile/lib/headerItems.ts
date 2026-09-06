import { Platform, type ColorValue } from "react-native";

const isIOS26Plus =
  Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26;

export const iosHeaderScreenOptions = isIOS26Plus
  ? {
      headerTransparent: true,
      headerShadowVisible: false,
      headerStyle: { backgroundColor: "transparent" as const },
    }
  : {};

export const automaticKeyboardInsets = {
  contentInsetAdjustmentBehavior:
    Platform.OS === "ios" ? ("automatic" as const) : undefined,
};

type HeaderTextAction = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tintColor?: ColorValue;
  variant?: "plain" | "done" | "prominent";
};

export function iosHeaderTextItems(actions: HeaderTextAction[]) {
  return actions.map((action) => ({
    type: "button" as const,
    label: action.label,
    onPress: action.onPress,
    disabled: action.disabled,
    tintColor: action.tintColor,
    variant: action.variant ?? "plain",
  }));
}
