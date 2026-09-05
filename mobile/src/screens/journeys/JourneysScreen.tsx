import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api, ApiError } from "../../api/client";
import { AppButton } from "../../components/AppButton";
import { LoadingView } from "../../components/LoadingView";
import { Screen } from "../../components/Screen";
import { TripCard } from "../../components/TripCard";
import { colors, radii, spacing, typography } from "../../theme";
import type { AppStackParamList, Journey, SharedJourney } from "../../types";
import { formatDateTime } from "../../utils";

export function JourneysScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [sharedJourneys, setSharedJourneys] = useState<SharedJourney[]>([]);
  const [view, setView] = useState<"mine" | "shared">("mine");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    try { const [mine, shared] = await Promise.all([api.journeys(), api.sharedJourneys()]); setJourneys(mine); setSharedJourneys(shared); setError(undefined); }
    catch (value) { setError((value as ApiError).message); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (loading) return <LoadingView label="Loading your journeys..." />;
  const active = journeys.filter((journey) => journey.status === "active" || journey.status === "overdue");
  const upcoming = journeys.filter((journey) => journey.status === "planned");
  const history = journeys.filter((journey) => journey.status === "ended" || journey.status === "cancelled");
  return (
    <Screen>
      <View style={styles.header}><View><Text style={typography.eyebrow}>YOUR TRAVELS</Text><Text style={typography.hero}>Journeys</Text></View><AppButton label="New" icon="add" style={styles.newButton} onPress={() => navigation.navigate("CreateJourney")} /></View>
      <View style={styles.segment}><Segment label="My trips" count={journeys.length} active={view === "mine"} onPress={() => setView("mine")} /><Segment label="Shared with me" count={sharedJourneys.length} active={view === "shared"} onPress={() => setView("shared")} /></View>
      {error && <Text style={styles.error}>{error}</Text>}
      {view === "mine" && (journeys.length === 0 ? <View style={styles.empty}><Text style={styles.emptyEmoji}>🧭</Text><Text style={typography.section}>No journeys yet</Text><Text style={[typography.body, styles.center]}>Choose a destination, describe what matters, and let Turtle monitor the route around your intent.</Text><AppButton label="Create a journey" onPress={() => navigation.navigate("CreateJourney")} /></View> : (
        <View style={styles.groups}>
          {active.length > 0 && <JourneyGroup title="Active now" journeys={active} navigation={navigation} featured />}
          {upcoming.length > 0 && <JourneyGroup title="Coming up" journeys={upcoming} navigation={navigation} />}
          {history.length > 0 && <JourneyGroup title="Journey history" journeys={history} navigation={navigation} />}
        </View>
      ))}
      {view === "shared" && (sharedJourneys.length === 0 ? <View style={styles.empty}><View style={styles.sharedEmptyIcon}><Ionicons name="people-outline" size={28} color={colors.forest} /></View><Text style={typography.section}>Nothing shared yet</Text><Text style={[typography.body, styles.center]}>When someone sends you a private Turtle Maps commute link, accept it to follow their timing and coarse journey status here.</Text></View> : <View style={styles.groups}>{sharedJourneys.map((journey) => <SharedCard key={journey.invitationId} journey={journey} onPress={() => navigation.navigate("SharedJourney", { journeyId: journey.journeyId })} />)}</View>)}
    </Screen>
  );
}

function Segment({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.segmentButton, active && styles.segmentActive]}><Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>{count > 0 && <View style={[styles.count, active && styles.countActive]}><Text style={[styles.countText, active && styles.countTextActive]}>{count}</Text></View>}</Pressable>;
}

function SharedCard({ journey, onPress }: { journey: SharedJourney; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.sharedCard, pressed && { opacity: 0.85 }]}><View style={styles.sharedTop}><View style={styles.sharedAvatar}><Text style={styles.sharedInitial}>{journey.travelerName.slice(0, 1).toUpperCase()}</Text></View><View style={{ flex: 1 }}><Text style={styles.sharedBy}>SHARED BY {journey.travelerName.toUpperCase()}</Text><Text style={styles.sharedDestination} numberOfLines={1}>{journey.destinationLabel}</Text></View><Ionicons name="chevron-forward" size={20} color={colors.moss} /></View><View style={styles.sharedMeta}><Text style={styles.sharedStatus}>{journey.status === "active" ? "On the way" : journey.status === "overdue" ? "Check-in overdue" : journey.status}</Text><Text style={styles.dot}>·</Text><Text style={styles.sharedTime}>{formatDateTime(journey.expectedArrivalAt)}</Text></View><View style={styles.viewOnly}><Ionicons name="eye-outline" size={15} color={colors.moss} /><Text style={styles.viewOnlyText}>View-only · coarse location</Text></View></Pressable>;
}

function JourneyGroup({ title, journeys, navigation, featured = false }: { title: string; journeys: Journey[]; navigation: NativeStackNavigationProp<AppStackParamList>; featured?: boolean }) {
  return <View style={styles.group}><Text style={typography.section}>{title}</Text>{journeys.map((journey) => <TripCard key={journey.id} journey={journey} featured={featured} onPress={() => navigation.navigate(journey.status === "active" || journey.status === "overdue" ? "ActiveJourney" : "JourneyDetail", { journeyId: journey.id })} />)}</View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xl },
  newButton: { minHeight: 46, paddingHorizontal: 15 },
  segment: { flexDirection: "row", padding: 4, borderRadius: 16, backgroundColor: colors.sageSoft, marginBottom: spacing.xl },
  segmentButton: { flex: 1, minHeight: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 },
  segmentActive: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  segmentText: { color: colors.moss, fontSize: 13, fontWeight: "800" },
  segmentTextActive: { color: colors.forest },
  count: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: colors.line, alignItems: "center", justifyContent: "center" },
  countActive: { backgroundColor: colors.lime },
  countText: { color: colors.moss, fontSize: 10, fontWeight: "900" },
  countTextActive: { color: colors.forest },
  groups: { gap: spacing.xl },
  group: { gap: 14 },
  empty: { marginTop: 54, backgroundColor: colors.paper, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.line, padding: 26, alignItems: "center", gap: 13 },
  emptyEmoji: { fontSize: 46 },
  sharedEmptyIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: colors.sageSoft, alignItems: "center", justifyContent: "center" },
  sharedCard: { backgroundColor: colors.paper, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.line, padding: 17, gap: 13 },
  sharedTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  sharedAvatar: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.peach, alignItems: "center", justifyContent: "center" },
  sharedInitial: { color: colors.forest, fontSize: 18, fontWeight: "900" },
  sharedBy: { color: colors.moss, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  sharedDestination: { color: colors.ink, marginTop: 3, fontSize: 17, fontWeight: "800" },
  sharedMeta: { flexDirection: "row", alignItems: "center", gap: 7 },
  sharedStatus: { color: colors.forest, fontSize: 13, fontWeight: "800", textTransform: "capitalize" },
  dot: { color: colors.moss },
  sharedTime: { color: colors.textMuted, fontSize: 12, flex: 1 },
  viewOnly: { flexDirection: "row", gap: 6, alignItems: "center", paddingTop: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  viewOnlyText: { color: colors.moss, fontSize: 11, fontWeight: "700" },
  center: { textAlign: "center", color: colors.textMuted },
  error: { color: colors.danger, marginBottom: 14 },
});
