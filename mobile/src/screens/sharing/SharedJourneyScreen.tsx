import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, ApiError } from "../../api/client";
import { LoadingView } from "../../components/LoadingView";
import { StatusPill } from "../../components/StatusPill";
import { colors, radii, spacing, typography } from "../../theme";
import type { AppStackParamList, SharedJourney } from "../../types";
import { formatDateTime } from "../../utils";

export function SharedJourneyScreen({ route }: NativeStackScreenProps<AppStackParamList, "SharedJourney">) {
  const [journey, setJourney] = useState<SharedJourney>();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setJourney(await api.sharedJourney(route.params.journeyId)); setError(undefined); }
    catch (value) { setError((value as ApiError).message); }
  }, [route.params.journeyId]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30_000); return () => clearInterval(timer); }, [load]);
  if (!journey && !error) return <LoadingView label="Loading shared commute..." />;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.forest} />}>
    {journey ? <>
      <View style={styles.header}><View style={{ flex: 1 }}><Text style={typography.eyebrow}>SHARED BY {journey.travelerName.toUpperCase()}</Text><Text style={[typography.hero, styles.title]}>{journey.destinationLabel}</Text></View><StatusPill label={journey.status} tone={journey.status === "overdue" ? "danger" : journey.status === "active" ? "success" : "neutral"} /></View>
      <View style={styles.routeCard}><View style={styles.routeLine}><View style={styles.routeDot} /><View style={styles.routeStem} /><Ionicons name="location" size={24} color={colors.forest} /></View><View style={styles.routeCopy}><Text style={styles.routeLabel}>COMMUTE</Text><Text style={typography.title}>{journey.title}</Text><Text style={typography.small}>Expected arrival · {formatDateTime(journey.expectedArrivalAt)}</Text></View></View>
      <View style={styles.grid}><Metric icon="time-outline" label="Last check-in" value={journey.lastCheckInAt ? formatDateTime(journey.lastCheckInAt) : "Not yet"} /><Metric icon="map-outline" label="Latest area" value={journey.lastCoarseArea ?? "Not shared yet"} /></View>
      {journey.lastAgentUpdate && <View style={styles.agentCard}><View style={styles.agentIcon}><Ionicons name="sparkles" size={19} color={colors.lime} /></View><View style={{ flex: 1 }}><Text style={styles.agentLabel}>ROUTE AGENT UPDATE</Text><Text style={styles.agentText}>{journey.lastAgentUpdate}</Text>{journey.lastAgentUpdateAt && <Text style={styles.agentTime}>{formatDateTime(journey.lastAgentUpdateAt)}</Text>}</View></View>}
      <View style={styles.readOnly}><Ionicons name="eye-outline" size={21} color={colors.forest} /><View style={{ flex: 1 }}><Text style={typography.bodyStrong}>View-only access</Text><Text style={typography.small}>Only {journey.travelerName} can check in, extend, end, call, or alert contacts. Precise coordinates and private instructions are never shown here.</Text></View></View>
      <Text style={styles.expiry}>Access expires {formatDateTime(journey.accessExpiresAt)} unless the traveler revokes it first.</Text>
    </> : null}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </ScrollView>;
}

function Metric({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return <View style={styles.metric}><Ionicons name={icon} size={20} color={colors.forest} /><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { padding: spacing.lg, paddingTop: 22, paddingBottom: 50 },
  header: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  title: { marginTop: 7 },
  routeCard: { marginTop: spacing.xl, padding: 20, borderRadius: radii.xl, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, flexDirection: "row", gap: 16 },
  routeLine: { width: 26, alignItems: "center" },
  routeDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.mint },
  routeStem: { flex: 1, width: 2, backgroundColor: colors.line, marginVertical: 5 },
  routeCopy: { flex: 1, gap: 6 },
  routeLabel: { color: colors.moss, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  grid: { flexDirection: "row", gap: 11, marginTop: 11 },
  metric: { flex: 1, minHeight: 132, borderRadius: radii.large, backgroundColor: colors.sageSoft, padding: 15, gap: 7 },
  metricLabel: { color: colors.moss, fontSize: 12, fontWeight: "800" },
  metricValue: { color: colors.ink, fontSize: 15, lineHeight: 21, fontWeight: "800" },
  agentCard: { flexDirection: "row", gap: 12, padding: 17, marginTop: 11, borderRadius: radii.large, backgroundColor: colors.forest },
  agentIcon: { width: 38, height: 38, borderRadius: 14, backgroundColor: "#ffffff18", alignItems: "center", justifyContent: "center" },
  agentLabel: { color: colors.lime, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  agentText: { color: colors.white, marginTop: 5, fontSize: 15, lineHeight: 21, fontWeight: "600" },
  agentTime: { color: "#ffffff99", marginTop: 7, fontSize: 12 },
  readOnly: { flexDirection: "row", gap: 12, marginTop: spacing.xl, padding: 17, borderWidth: 1, borderColor: colors.line, borderRadius: radii.large, backgroundColor: colors.paper },
  expiry: { ...typography.small, textAlign: "center", marginTop: 18 },
  error: { color: colors.danger, fontWeight: "600", marginTop: spacing.xl },
});
