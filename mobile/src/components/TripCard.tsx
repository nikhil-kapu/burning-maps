import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, shadow, typography } from "../theme";
import type { Journey } from "../types";
import { StatusPill } from "./StatusPill";

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function TripCard({ journey, onPress, featured = false }: { journey: Journey; onPress: () => void; featured?: boolean }) {
  const active = journey.status === "active" || journey.status === "overdue";
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, featured && styles.featured, pressed && styles.pressed]}>
      <View style={styles.topRow}>
        <StatusPill label={journey.status === "overdue" ? "Check in due" : journey.status} tone={journey.status === "overdue" ? "danger" : active ? "accent" : journey.status === "ended" ? "success" : "neutral"} />
        <Ionicons name="arrow-forward-circle" size={28} color={featured ? colors.lime : colors.forest} />
      </View>
      <Text style={[typography.section, featured && styles.light]}>{journey.title}</Text>
      <View style={styles.route}>
        <View style={[styles.dot, featured && styles.dotLight]} />
        <View style={[styles.line, featured && styles.lineLight]} />
        <View style={[styles.dot, featured && styles.dotLight]} />
        <Text style={[styles.destination, featured && styles.mint]} numberOfLines={1}>{journey.destinationLabel}</Text>
      </View>
      <View style={styles.metaRow}>
        <View><Text style={[styles.metaLabel, featured && styles.mint]}>ARRIVAL</Text><Text style={[styles.metaValue, featured && styles.light]}>{formatTime(journey.expectedArrivalAt)}</Text></View>
        <View><Text style={[styles.metaLabel, featured && styles.mint]}>CHECK-IN</Text><Text style={[styles.metaValue, featured && styles.light]}>{journey.nextCheckInAt ? formatTime(journey.nextCheckInAt) : "At start"}</Text></View>
        <View><Text style={[styles.metaLabel, featured && styles.mint]}>CIRCLE</Text><Text style={[styles.metaValue, featured && styles.light]}>{journey.contactCount} {journey.contactCount === 1 ? "person" : "people"}</Text></View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { ...shadow, backgroundColor: colors.paper, borderRadius: radii.large, borderWidth: 1, borderColor: colors.line, padding: 18, gap: 14 },
  featured: { backgroundColor: colors.forestDeep, borderColor: colors.forestDeep },
  pressed: { transform: [{ scale: 0.99 }], opacity: 0.92 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  route: { flexDirection: "row", alignItems: "center", minHeight: 24 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.forest },
  dotLight: { backgroundColor: colors.lime },
  line: { height: 2, width: 30, backgroundColor: colors.line, marginHorizontal: 5 },
  lineLight: { backgroundColor: "#40675D" },
  destination: { ...typography.small, color: colors.ink, flex: 1, marginLeft: 8 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  metaLabel: { color: colors.textMuted, fontSize: 9, fontWeight: "900", letterSpacing: 1.1, marginBottom: 4 },
  metaValue: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  light: { color: colors.white },
  mint: { color: colors.mint },
});
