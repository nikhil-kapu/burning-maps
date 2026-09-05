import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import { colors, radii, typography } from "../theme";

type Props = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "dark";
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
};

export function AppButton({ label, onPress, variant = "primary", icon, loading, disabled, style, accessibilityHint }: Props) {
  const handlePress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    onPress();
  };
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.base, styles[variant], pressed && styles.pressed, (disabled || loading) && styles.disabled, style]}
    >
      {loading ? <ActivityIndicator color={variant === "secondary" || variant === "ghost" ? colors.forest : colors.white} /> : (
        <>
          {icon && <Ionicons name={icon} size={20} color={variant === "secondary" || variant === "ghost" ? colors.forest : colors.white} />}
          <Text style={[typography.button, styles.text, variant === "secondary" || variant === "ghost" ? styles.darkText : styles.lightText]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 56, borderRadius: 14, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  primary: { backgroundColor: colors.forestDeep },
  secondary: { backgroundColor: colors.paper, borderWidth: 1.5, borderColor: colors.line },
  ghost: { backgroundColor: "transparent" },
  danger: { backgroundColor: colors.danger },
  dark: { backgroundColor: colors.forest },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.9 },
  disabled: { opacity: 0.45 },
  text: { textAlign: "center" },
  darkText: { color: colors.forest },
  lightText: { color: colors.white },
});
