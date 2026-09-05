import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radii } from "../theme";

export function StatusPill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "warning" | "danger" | "accent" }) {
  return <View style={[styles.pill, styles[tone]]}><Text style={[styles.text, tone === "danger" && styles.dangerText]}>{label.toUpperCase()}</Text></View>;
}

const styles = StyleSheet.create({
  pill: { alignSelf: "flex-start", borderRadius: radii.pill, paddingVertical: 7, paddingHorizontal: 11, backgroundColor: colors.line },
  neutral: { backgroundColor: colors.line },
  success: { backgroundColor: colors.mint },
  warning: { backgroundColor: colors.peach },
  danger: { backgroundColor: "#FFE0D9" },
  accent: { backgroundColor: colors.lime },
  text: { fontSize: 11, fontWeight: "900", letterSpacing: 0.9, color: colors.forest },
  dangerText: { color: colors.danger },
});

