import React from "react";
import { StyleSheet, Text } from "react-native";
import { colors } from "../theme";

export function LegalAgreement({ onTerms, onPrivacy }: { onTerms: () => void; onPrivacy: () => void }) {
  return (
    <Text style={styles.copy}>
      By continuing, you agree to the Turtle Maps{" "}
      <Text accessibilityRole="link" onPress={onTerms} style={styles.link}>Terms of Use</Text>
      {" "}and acknowledge the{" "}
      <Text accessibilityRole="link" onPress={onPrivacy} style={styles.link}>Privacy Policy</Text>.
    </Text>
  );
}

const styles = StyleSheet.create({
  copy: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: "center", paddingHorizontal: 8 },
  link: { color: colors.forest, fontWeight: "800", textDecorationLine: "underline" },
});
