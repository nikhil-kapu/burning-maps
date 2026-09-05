import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, typography } from "../theme";

export function LoadingView({ label = "Getting things ready..." }: { label?: string }) {
  return <View style={styles.container}><ActivityIndicator size="large" color={colors.forest} /><Text style={typography.small}>{label}</Text></View>;
}

const styles = StyleSheet.create({ container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, backgroundColor: colors.cream } });

