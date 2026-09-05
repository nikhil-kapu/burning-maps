import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, radii, typography } from "../theme";

type Props = TextInputProps & {
  label: string;
  error?: string;
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
};

export function TextField({ label, error, hint, icon, secureTextEntry, style, ...props }: Props) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(Boolean(secureTextEntry));
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputShell, focused && styles.inputFocused, error && styles.inputError]}>
        {icon && <Ionicons name={icon} size={20} color={focused ? colors.forest : colors.moss} />}
        <TextInput
          {...props}
          secureTextEntry={secureTextEntry ? hidden : false}
          onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
          placeholderTextColor="#8A9690"
          autoCapitalize={props.autoCapitalize ?? "none"}
          style={[styles.input, style]}
        />
        {secureTextEntry && (
          <Pressable onPress={() => setHidden((value) => !value)} hitSlop={12} accessibilityRole="button" accessibilityLabel={hidden ? "Show password" : "Hide password"}>
            <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={21} color={colors.moss} />
          </Pressable>
        )}
      </View>
      {(error || hint) && <Text style={[typography.small, styles.hint, error && styles.errorText]}>{error ?? hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 7 },
  label: { fontSize: 14, fontWeight: "700", color: colors.ink },
  inputShell: { minHeight: 54, borderWidth: 1.5, borderColor: colors.line, borderRadius: radii.medium, backgroundColor: colors.paper, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 15 },
  inputFocused: { borderColor: colors.forest },
  inputError: { borderColor: colors.danger },
  input: { flex: 1, minHeight: 50, fontSize: 16, color: colors.ink },
  hint: { marginLeft: 3 },
  errorText: { color: colors.danger },
});

