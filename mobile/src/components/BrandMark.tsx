import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

export function BrandMark({ inverse = false, compact = false }: { inverse?: boolean; compact?: boolean }) {
  return (
    <View style={styles.row} accessibilityLabel="Turtle Maps">
      <View style={[styles.icon, inverse && styles.iconInverse, compact && styles.iconCompact]}>
        <Ionicons name="navigate" size={compact ? 15 : 18} color={colors.white} />
      </View>
      <View>
        <Text style={[styles.name, inverse && styles.inverseText, compact && styles.nameCompact]}>TURTLE MAPS</Text>
        {!compact && <Text style={[styles.tagline, inverse && styles.inverseTagline]}>MAPS THAT THINK AHEAD</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  iconInverse: { backgroundColor: colors.accent },
  iconCompact: { width: 30, height: 30, borderRadius: 10 },
  name: { color: colors.forest, fontSize: 15, fontWeight: "900", letterSpacing: 1.1 },
  nameCompact: { fontSize: 14 },
  inverseText: { color: colors.white },
  tagline: { color: colors.moss, fontSize: 8, fontWeight: "800", letterSpacing: 1.25, marginTop: 2 },
  inverseTagline: { color: colors.sageSoft },
});
