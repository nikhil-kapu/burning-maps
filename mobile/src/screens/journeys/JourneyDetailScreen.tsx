import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Location from "expo-location";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import TurtleMapSearch, { type RouteCoordinate } from "../../../modules/turtle-map-search";
import { api, ApiError } from "../../api/client";
import { AppButton } from "../../components/AppButton";
import { LoadingView } from "../../components/LoadingView";
import { Screen } from "../../components/Screen";
import { StatusPill } from "../../components/StatusPill";
import { startJourneyLocation } from "../../location/background";
import { resolveCurrentRouteOrigin, RouteOriginError } from "../../location/routeOrigin";
import { registerForPushNotifications } from "../../notifications";
import { buildAgenticRouteCandidates, candidateEvidence, presentRouteOptions, type JourneyRouteCandidate, type PresentedRouteOption } from "../../routing/agenticRoutes";
import { encodeRoutePolyline } from "../../routing/routeGeometry";
import { colors, radii, spacing, typography } from "../../theme";
import type { AppStackParamList, Journey, RouteCandidateRanking, SelectedJourneyRoute } from "../../types";
import { formatDateTime } from "../../utils";

export function JourneyDetailScreen({ route, navigation }: NativeStackScreenProps<AppStackParamList, "JourneyDetail">) {
  const [journey, setJourney] = useState<Journey>();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string>();
  const [routeOptions, setRouteOptions] = useState<PresentedRouteOption[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>();
  const [routePreviewLoading, setRoutePreviewLoading] = useState(false);
  const [routePlanningStage, setRoutePlanningStage] = useState("Opening Apple Maps…");
  const [routePreviewError, setRoutePreviewError] = useState<string>();
  const [routeOriginNotice, setRouteOriginNotice] = useState<string>();
  const [routeReloadKey, setRouteReloadKey] = useState(0);
  const [rankingMode, setRankingMode] = useState<"ai" | "deterministic">();
  const [mapReady, setMapReady] = useState(false);
  const { width: viewportWidth } = useWindowDimensions();
  const mapRef = useRef<MapView>(null);
  const routeCarouselRef = useRef<ScrollView>(null);
  const routeCardWidth = Math.max(260, viewportWidth - 88);
  const routeSnapInterval = routeCardWidth + 10;
  const selectedRouteOption = useMemo(() => routeOptions.find((option) => option.candidate.id === selectedRouteId) ?? routeOptions[0], [routeOptions, selectedRouteId]);
  const routePreview = selectedRouteOption?.candidate;
  const selectedRouteIndex = Math.max(0, routeOptions.findIndex((option) => option.candidate.id === routePreview?.id));
  const mapSwipeResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => routeOptions.length > 1
      && Math.abs(gesture.dx) > 12
      && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
    onPanResponderRelease: (_event, gesture) => {
      if (Math.abs(gesture.dx) < 32) return;
      const nextIndex = Math.min(routeOptions.length - 1, Math.max(0, selectedRouteIndex + (gesture.dx < 0 ? 1 : -1)));
      setSelectedRouteId(routeOptions[nextIndex]?.candidate.id);
    },
  }), [routeOptions, selectedRouteIndex]);

  useEffect(() => {
    if (!routeOptions.length) return;
    routeCarouselRef.current?.scrollTo({ x: selectedRouteIndex * routeSnapInterval, animated: true });
  }, [routeOptions.length, routeSnapInterval, selectedRouteIndex]);
  useEffect(() => { void api.journey(route.params.journeyId).then(setJourney).catch((value: ApiError) => setError(value.message)).finally(() => setLoading(false)); }, [route.params.journeyId]);

  useEffect(() => {
    const destinationCoordinate = journey?.destinationCoordinate;
    if (!journey || !destinationCoordinate) return;
    let cancelled = false;

    const loadRoutePreview = async () => {
      setRoutePreviewLoading(true);
      setRouteOptions([]);
      setSelectedRouteId(undefined);
      setRoutePreviewError(undefined);
      setRouteOriginNotice(undefined);
      try {
        const mapSearch = TurtleMapSearch;
        if (!mapSearch) throw new Error("Native Apple Maps routing is unavailable on this device.");
        if (typeof mapSearch.calculateRouteAlternatives !== "function") throw new Error("Install the current Turtle Maps development build to compare route alternatives.");

        let originCoordinate: RouteCoordinate | undefined;
        const originLabel = journey.originLabel?.trim();
        if (originLabel && originLabel.toLowerCase() !== "current location") {
          const matches = await Location.geocodeAsync(originLabel).catch(() => []);
          if (matches[0]) originCoordinate = { latitude: matches[0].latitude, longitude: matches[0].longitude };
        }

        if (!originCoordinate) {
          const resolvedOrigin = await resolveCurrentRouteOrigin();
          originCoordinate = resolvedOrigin.coordinate;
          if (!cancelled && resolvedOrigin.source === "last_known") {
            setRouteOriginNotice("Using your last known location because a fresh GPS fix was unavailable. Tap Use live location to try again.");
          }
          if (!cancelled && resolvedOrigin.source === "simulator_demo") {
            setRouteOriginNotice("Simulator is using San Francisco as the demo start. Set a simulated location, then tap Use live location to change it.");
          }
        }

        const origin = originCoordinate;
        const buildCandidates = () => buildAgenticRouteCandidates({
          mapSearch,
          journey,
          origin,
          destination: destinationCoordinate,
          onStage: (stage) => { if (!cancelled) setRoutePlanningStage(stage); },
        });
        let built;
        try {
          built = await buildCandidates();
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 700));
          if (cancelled) return;
          built = await buildCandidates();
        }
        if (!built.candidates.length) throw new Error("Apple Maps did not return any complete routes through the required places.");
        if (!cancelled) setRoutePlanningStage("Letting Turtle compare the evidence…");
        let ranking: RouteCandidateRanking;
        try {
          ranking = await api.rankRouteCandidates(journey.id, built.candidates.map(candidateEvidence));
        } catch {
          ranking = fallbackRouteRanking(built.candidates, journey.preferences.routeObjective?.detourBudgetPercent ?? 35);
        }
        const options = presentRouteOptions(built.candidates, ranking, journey.preferences.routeObjective?.label ?? "Best match");
        if (!cancelled) {
          setRouteOptions(options);
          setRankingMode(ranking.rankingMode);
          setSelectedRouteId(options.find((option) => option.recommended)?.candidate.id ?? options[0]?.candidate.id);
        }
      } catch (value) {
        if (!cancelled) setRoutePreviewError(routePreviewMessage(value));
      } finally {
        if (!cancelled) setRoutePreviewLoading(false);
      }
    };

    void loadRoutePreview();
    return () => { cancelled = true; };
  }, [journey?.id, routeReloadKey]);

  useEffect(() => {
    const destinationCoordinate = journey?.destinationCoordinate;
    if (!mapReady || !routePreview || !destinationCoordinate) return;
    const fitCoordinates: RouteCoordinate[] = [
      routePreview.origin,
      ...routePreview.coordinates,
      ...routePreview.waypoints.map((waypoint) => waypoint.coordinate),
      destinationCoordinate,
    ];
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(fitCoordinates, {
        animated: false,
        edgePadding: { top: 68, right: 38, bottom: 162, left: 38 },
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [journey?.destinationCoordinate, mapReady, routePreview]);
  if (loading) return <LoadingView label="Opening your journey..." />;
  if (!journey) return <Screen safeTop={false}><Text style={styles.error}>{error ?? "Journey not found."}</Text></Screen>;
  const start = async () => {
    setStarting(true); setError(undefined);
    let started: Journey;
    try {
      if (selectedRouteOption) {
        const selection: SelectedJourneyRoute = {
          candidateId: selectedRouteOption.candidate.id,
          label: selectedRouteOption.label,
          rationale: selectedRouteOption.rationale,
          durationSeconds: Math.round(selectedRouteOption.candidate.expectedTravelTimeSeconds),
          distanceMeters: selectedRouteOption.candidate.distanceMeters,
          waypointLabels: selectedRouteOption.candidate.waypoints.map((waypoint) => waypoint.place.label),
          routeNames: selectedRouteOption.candidate.routeNames,
          routePolyline: encodeRoutePolyline(selectedRouteOption.candidate.coordinates),
          routeWaypoints: selectedRouteOption.candidate.waypoints.map((waypoint) => ({
            label: waypoint.place.label,
            latitude: waypoint.coordinate.latitude,
            longitude: waypoint.coordinate.longitude,
            role: waypoint.role,
            ...(waypoint.purpose ? { purpose: waypoint.purpose } : {}),
          })),
          navigationSteps: selectedRouteOption.candidate.navigationSteps.slice(0, 200),
        };
        await api.selectJourneyRoute(journey.id, selection);
      }
      started = await api.startJourney(journey.id);
    } catch (value) {
      const apiError = value as ApiError;
      if (apiError.code === "PHONE_REQUIRED_FOR_SHARING") {
        Alert.alert("Add your phone number", "A phone number is required before Turtle Maps can share this commute with your trusted people.", [{ text: "Not now", style: "cancel" }, { text: "Open profile", onPress: () => navigation.navigate("EditProfile") }]);
      } else setError(apiError.message);
      setStarting(false);
      return;
    }
    const limitations: string[] = [];
    try {
      const permission = await startJourneyLocation(journey.id);
      if (!permission.foreground) limitations.push("Location access is off, so route progress cannot be shared.");
      else if (!permission.background) limitations.push("Background location is off, so continuous tracking works only while the app is open.");
    } catch {
      limitations.push("Location monitoring could not be started on this device.");
    }
    try {
      const pushStatus = await registerForPushNotifications();
      if (pushStatus === "denied") limitations.push("Notifications are off, so in-app route updates may be missed.");
      if (pushStatus === "unconfigured") limitations.push("Push delivery is not configured in this build.");
    } catch {
      limitations.push("Push notifications could not be registered.");
    }
    setStarting(false);
    navigation.replace("ActiveJourney", { journeyId: started.id });
    if (limitations.length > 0) Alert.alert("Journey started with limited monitoring", limitations.join("\n\n"));
  };
  const cancel = () => Alert.alert(
    "Cancel this plan?",
    "The journey will move to your history. No contacts will be notified.",
    [
      { text: "Keep plan", style: "cancel" },
      { text: "Cancel journey", style: "destructive", onPress: async () => {
        setCancelling(true); setError(undefined);
        try { await api.cancelJourney(journey.id); navigation.goBack(); }
        catch (value) { setError((value as ApiError).message); }
        finally { setCancelling(false); }
      } },
    ],
  );
  return (
    <Screen safeTop={false}>
      <StatusPill label={journey.status} tone={journey.status === "planned" ? "neutral" : journey.status === "ended" ? "success" : "warning"} />
      <Text style={[typography.hero, styles.title]}>{journey.title}</Text>
      {journey.destinationCoordinate && <View accessibilityLabel="Full route preview" style={styles.map} {...mapSwipeResponder.panHandlers}>
        <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={{ ...journey.destinationCoordinate, latitudeDelta: 0.045, longitudeDelta: 0.045 }} onMapReady={() => setMapReady(true)} scrollEnabled={false} zoomEnabled={false} pitchEnabled={false} rotateEnabled={false} pointerEvents="none">
          {routeOptions.filter((option) => option.candidate.id !== routePreview?.id).map((option) => <Polyline key={option.candidate.id} coordinates={option.candidate.coordinates} strokeColor="rgba(101,104,95,0.52)" strokeWidth={4} lineCap="round" lineJoin="round" />)}
          {routePreview && <Polyline coordinates={routePreview.coordinates} strokeColor={colors.accent} strokeWidth={7} lineCap="round" lineJoin="round" />}
          {routePreview && <Marker coordinate={routePreview.origin} title={journey.originLabel ?? "Current location"} pinColor={colors.forest} />}
          {routePreview?.waypoints.map((waypoint) => <Marker key={`${waypoint.requestedLabel}-${waypoint.coordinate.latitude}-${waypoint.coordinate.longitude}`} accessibilityLabel={`${waypoint.role === "required" ? "Via" : "Agent anchor"} ${waypoint.place.title}`} coordinate={waypoint.coordinate} title={`${waypoint.role === "required" ? "Via" : "Agent anchor"} ${waypoint.place.title}`} description={waypoint.purpose ?? waypoint.place.subtitle} pinColor={waypoint.role === "required" ? colors.forest : colors.coral} />)}
          <Marker coordinate={journey.destinationCoordinate} title={journey.destinationLabel} pinColor={colors.coral} />
        </MapView>
        <View style={styles.mapChip}>
          {routePreviewLoading ? <ActivityIndicator size="small" color={colors.lime} /> : <Ionicons name={routePreview ? "navigate" : "flag"} size={15} color={colors.lime} />}
          <Text style={styles.mapChipText}>{routePreviewLoading ? routePlanningStage : routePreview ? "Full route preview" : "Destination pinned"}</Text>
        </View>
        {routePreview && routePreview.waypoints.some((waypoint) => waypoint.role === "required") && <View style={styles.routeViaChip}><Ionicons name="git-branch-outline" size={13} color={colors.forestDeep} /><Text numberOfLines={1} style={styles.routeViaChipText}>via {routePreview.waypoints.filter((waypoint) => waypoint.role === "required").map((waypoint) => waypoint.place.title).join(" · ")}</Text></View>}
        {!routePreviewLoading && routeOptions.length > 1 && <View pointerEvents="none" style={styles.mapSwipeHint}><Ionicons name="chevron-back" size={11} color={colors.forestDeep} /><Text style={styles.mapSwipeHintText}>Swipe routes</Text><Text style={styles.mapSwipeCount}>{selectedRouteIndex + 1}/{routeOptions.length}</Text><Ionicons name="chevron-forward" size={11} color={colors.forestDeep} /></View>}
        {routePreviewLoading && <MapRouteLoading stage={routePlanningStage} />}
        {!routePreviewLoading && routeOptions.length > 0 && <MapRouteCarousel carouselRef={routeCarouselRef} options={routeOptions} selectedRouteId={routePreview?.id} rankingMode={rankingMode} cardWidth={routeCardWidth} snapInterval={routeSnapInterval} onSelect={setSelectedRouteId} />}
      </View>}
      {routePreviewError && <View style={styles.routePreviewNotice}><Ionicons name="information-circle-outline" size={18} color={colors.forest} /><View style={{ flex: 1 }}><Text style={styles.routePreviewNoticeText}>{routePreviewError}</Text><Pressable accessibilityRole="button" accessibilityLabel="Try route planning again" onPress={() => setRouteReloadKey((value) => value + 1)} style={styles.retryRoute}><Text style={styles.retryRouteText}>Try again</Text></Pressable></View></View>}
      {!routePreviewError && routeOriginNotice && <View style={styles.routeOriginNotice}><Ionicons name="location-outline" size={18} color={colors.forest} /><Text style={styles.routeOriginNoticeText}>{routeOriginNotice}</Text><Pressable accessibilityRole="button" accessibilityLabel="Use live location" onPress={() => setRouteReloadKey((value) => value + 1)} style={styles.liveLocationButton}><Text style={styles.liveLocationButtonText}>Use live location</Text></Pressable></View>}
      <View style={styles.routeCard}><View style={styles.routeLine}><View style={styles.dot} /><View style={styles.line} /><View style={[styles.dot, styles.dotEnd]} /></View><View style={{ flex: 1 }}><Text style={styles.routeLabel}>DESTINATION</Text><Text style={typography.section}>{journey.destinationLabel}</Text>{journey.originLabel && <Text style={[typography.small, styles.origin]}>From {journey.originLabel}</Text>}</View></View>
      {routePreferenceLabel(journey) && <View style={styles.preferenceApplied}><Ionicons name="sparkles" size={16} color={colors.accent} /><Text style={styles.preferenceAppliedText}>{routePreferenceLabel(journey)}</Text></View>}
      <View style={styles.metrics}><Metric icon="navigate-outline" label="Traveling by" value={modeLabel(journey.travelMode)} /><Metric icon="time-outline" label="Expected arrival" value={formatDateTime(journey.expectedArrivalAt)} /><Metric icon="notifications-outline" label="Check-in rhythm" value={`Every ${journey.checkInIntervalMinutes} minutes`} /><Metric icon="people-outline" label="Safety circle" value={`${journey.contactCount} ${journey.contactCount === 1 ? "person" : "people"}`} /><Metric icon="call-outline" label="Missed check-in call" value={journey.voiceCallEnabled ? "Enabled" : "Not enabled"} /></View>
      <View style={styles.buddy}><View style={styles.buddyIcon}><Ionicons name="pulse" size={21} color={colors.lime} /></View><View style={{ flex: 1 }}><Text style={styles.buddyEyebrow}>ROUTE AGENT</Text><Text style={styles.buddyTitle}>{!journey.companionUpdatesEnabled ? "Live route updates are off" : journey.deliveryCapabilities.routeUpdatesLive ? "Monitoring what could change the trip" : "Route-update simulation is active"}</Text><Text style={styles.buddyCopy}>{!journey.companionUpdatesEnabled ? "Deterministic safety check-ins still run as planned." : journey.deliveryCapabilities.routeUpdatesLive ? `${journey.companionCallEnabled ? "Push and voice" : "Push"} updates when delays exceed ${journey.updateDelayThresholdMinutes} minutes.` : "This build records test updates, but Google Routes delivery is not configured yet."}</Text>{journey.agentInstructions && <Text style={styles.agentBrief}>“{journey.agentInstructions}”</Text>}</View></View>
      {journey.notes && <View style={styles.note}><Text style={styles.routeLabel}>PRIVATE NOTE</Text><Text style={typography.body}>{journey.notes}</Text></View>}
      <View style={styles.privacy}><Ionicons name="location-outline" size={21} color={colors.forest} /><Text style={[typography.small, { flex: 1 }]}>Starting sends each selected person a private account-gated invitation. Add your phone number in Profile first. Precise location stays private.</Text></View>
      {error && <Text style={styles.error}>{error}</Text>}
      {journey.status === "planned" && <View style={styles.plannedActions}><AppButton label="Start selected route" icon="navigate" loading={starting} disabled={cancelling || routePreviewLoading || !selectedRouteOption} onPress={() => void start()} /><AppButton label="Cancel plan" variant="ghost" loading={cancelling} disabled={starting} onPress={cancel} /></View>}
      {(journey.status === "active" || journey.status === "overdue") && <AppButton label="Open active journey" onPress={() => navigation.replace("ActiveJourney", { journeyId: journey.id })} />}
    </Screen>
  );
}

function modeLabel(mode: Journey["travelMode"]): string { return ({ driving: "Driving", public_transit: "Public transit", bus: "Bus", subway: "Subway", train: "Train", taxi: "Taxi", rideshare: "Rideshare", walking: "Walking", cycling: "Cycling" })[mode]; }

function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

function routePreviewMessage(value: unknown): string {
  if (value instanceof RouteOriginError) return value.message;
  const message = value instanceof Error ? value.message : "";
  if (/FunctionCallException|getCurrentPositionAsync|expo-location/i.test(message)) {
    return "Turtle Maps could not get your starting location. Check Location Services and try again.";
  }
  return message || "The full route preview is temporarily unavailable. Try again in a moment.";
}

function routePreferenceLabel(journey: Journey): string | null {
  const labels: string[] = [];
  if (journey.preferences.viaWaypoints?.length) labels.push(`via ${journey.preferences.viaWaypoints.join(" · ")}`);
  if (journey.preferences.routeObjective) labels.push(`${journey.preferences.routeObjective.label.toLocaleLowerCase("en-US")} objective`);
  if (journey.preferences.avoidTolls) labels.push("avoiding tolls");
  if (journey.preferences.fewerTransfers) labels.push("fewer transfers");
  if (!labels.length || !journey.agentInstructions) return null;
  return `Route brief applied: ${labels.join(" · ")}`;
}

function MapRouteCarousel({
  carouselRef,
  options,
  selectedRouteId,
  rankingMode,
  cardWidth,
  snapInterval,
  onSelect,
}: {
  carouselRef: React.RefObject<ScrollView | null>;
  options: PresentedRouteOption[];
  selectedRouteId?: string;
  rankingMode?: "ai" | "deterministic";
  cardWidth: number;
  snapInterval: number;
  onSelect: (candidateId: string) => void;
}) {
  const fastestSeconds = Math.min(...options.map((option) => option.candidate.expectedTravelTimeSeconds));
  const selectAtOffset = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.min(options.length - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / snapInterval)));
    if (options[index]) onSelect(options[index].candidate.id);
  };
  return <View style={styles.mapRouteCarousel}>
    <ScrollView
      ref={carouselRef}
      horizontal
      accessibilityLabel="Route choices on map"
      accessibilityHint={`Swipe left or right to compare ${options.length} routes`}
      showsHorizontalScrollIndicator={false}
      nestedScrollEnabled
      decelerationRate="fast"
      snapToInterval={snapInterval}
      snapToAlignment="start"
      disableIntervalMomentum
      contentContainerStyle={styles.mapRouteCarouselContent}
      onMomentumScrollEnd={selectAtOffset}
    >
      {options.map((option, index) => {
        const selected = option.candidate.id === selectedRouteId;
        const extraMinutes = Math.max(0, Math.round((option.candidate.expectedTravelTimeSeconds - fastestSeconds) / 60));
        return <Pressable
          key={option.candidate.id}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={`${option.label}, ${formatDuration(option.candidate.expectedTravelTimeSeconds)}, ${formatDistance(option.candidate.distanceMeters)}`}
          onPress={() => onSelect(option.candidate.id)}
          style={({ pressed }) => [styles.mapRouteCard, { width: cardWidth }, selected && styles.mapRouteCardSelected, pressed && styles.routeOptionPressed]}
        >
          <View style={styles.mapRouteCardBody}>
            <View style={styles.mapRouteCardTopline}>
              <View style={styles.mapRouteCardTitleRow}>
                <Text numberOfLines={1} style={styles.mapRouteCardLabel}>{option.label}</Text>
                {option.recommended && option.matchScore >= 60 && <View style={styles.recommendedPill}><Text style={styles.recommendedPillText}>TOP PICK</Text></View>}
              </View>
              <View style={styles.mapRouteCardNumbers}><Text style={styles.mapRouteCardTime}>{formatDuration(option.candidate.expectedTravelTimeSeconds)}</Text><Text style={styles.mapRouteCardDistance}>{formatDistance(option.candidate.distanceMeters)}</Text></View>
            </View>
            <Text numberOfLines={1} style={styles.mapRouteCardRationale}>{option.rationale}</Text>
            <View style={styles.mapRouteCardFooter}>
              <Text style={styles.routeCardIndex}>{index + 1} OF {options.length}</Text>
              <View style={styles.mapRouteTraits}>
                {option.alsoQuickest && !option.label.toLocaleLowerCase("en-US").includes("quickest") && <Text style={styles.routeTrait}>QUICKEST</Text>}
                {option.alsoShortest && !option.label.toLocaleLowerCase("en-US").includes("shortest") && <Text style={styles.routeTrait}>SHORTEST</Text>}
                {extraMinutes > 0 && <Text style={styles.routeDelta}>+{extraMinutes} MIN</Text>}
                <View style={styles.mapRankingDot} /><Text style={styles.mapRankingText}>{rankingMode === "ai" ? "AI RANKED" : "SMART RANKED"}</Text>
              </View>
            </View>
          </View>
        </Pressable>;
      })}
    </ScrollView>
  </View>;
}

function MapRouteLoading({ stage }: { stage: string }) {
  return <View style={styles.mapRouteLoading} accessibilityLabel="Building route options">
    <View style={styles.mapRouteLoadingIcon}><ActivityIndicator color={colors.accent} /></View>
    <View style={{ flex: 1 }}><Text style={styles.mapRouteLoadingEyebrow}>ROUTE AGENT</Text><Text numberOfLines={1} style={styles.mapRouteLoadingTitle}>{stage}</Text></View>
    <View style={styles.mapRouteLoadingSteps}>{[0, 1, 2].map((value) => <View key={value} style={[styles.mapRouteLoadingStep, value === 0 && styles.mapRouteLoadingStepActive]} />)}</View>
  </View>;
}

function fallbackRouteRanking(candidates: JourneyRouteCandidate[], detourBudgetPercent: number): RouteCandidateRanking {
  const fastest = Math.min(...candidates.map((candidate) => candidate.expectedTravelTimeSeconds));
  const maximumDuration = fastest * (1 + detourBudgetPercent / 100);
  const evaluations = candidates.map((candidate) => {
    const anchorCount = candidate.waypoints.filter((waypoint) => waypoint.role === "agent").length;
    const detourRatio = (candidate.expectedTravelTimeSeconds - fastest) / fastest;
    const withinBudget = candidate.expectedTravelTimeSeconds <= maximumDuration;
    return {
      candidateId: candidate.id,
      matchScore: Math.round(Math.max(0, Math.min(100, 62 + anchorCount * 16 + (candidate.profile === "preference" ? 8 : 0) - detourRatio * 55 - (withinBudget ? 0 : 35)))),
      rationale: anchorCount
        ? "Uses a Maps-validated place proposed from your route brief."
        : "Balances the requested places with time and distance.",
    };
  });
  const eligible = evaluations.filter((evaluation) => candidates.find((candidate) => candidate.id === evaluation.candidateId)!.expectedTravelTimeSeconds <= maximumDuration);
  const recommendedCandidateId = [...(eligible.length ? eligible : evaluations)].sort((left, right) => right.matchScore - left.matchScore)[0]!.candidateId;
  return { recommendedCandidateId, evaluations, rankingMode: "deterministic" };
}

function Metric({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return <View style={styles.metric}><View style={styles.metricIcon}><Ionicons name={icon} size={20} color={colors.forest} /></View><View style={{ flex: 1 }}><Text style={styles.routeLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View></View>;
}

const styles = StyleSheet.create({
  title: { marginTop: 14, marginBottom: spacing.lg },
  map: { height: 420, borderRadius: radii.xl, overflow: "hidden", marginBottom: 12, backgroundColor: colors.sky, borderWidth: 1, borderColor: colors.line },
  mapChip: { position: "absolute", left: 12, top: 12, maxWidth: "56%", backgroundColor: colors.forestDeep, borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6 },
  mapChipText: { color: colors.white, fontSize: 12, fontWeight: "800" },
  mapSwipeHint: { position: "absolute", right: 12, top: 14, height: 30, borderRadius: radii.pill, backgroundColor: "rgba(252,251,248,0.96)", paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 3 },
  mapSwipeHintText: { color: colors.forestDeep, fontSize: 9, lineHeight: 12, fontWeight: "800" },
  mapSwipeCount: { color: colors.accent, fontSize: 9, lineHeight: 12, fontWeight: "900", marginLeft: 2 },
  routeViaChip: { position: "absolute", left: 12, top: 54, maxWidth: "72%", minHeight: 30, borderRadius: radii.pill, backgroundColor: "rgba(252,251,248,0.96)", paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  routeViaChipText: { flexShrink: 1, color: colors.forestDeep, fontSize: 11, lineHeight: 15, fontWeight: "800" },
  mapRouteCarousel: { position: "absolute", left: 0, right: 0, bottom: 9, height: 120 },
  mapRouteCarouselContent: { paddingHorizontal: 12, gap: 10 },
  mapRouteCard: { height: 112, borderRadius: 20, borderWidth: 1, borderColor: "rgba(17,18,15,0.14)", backgroundColor: "rgba(252,251,248,0.97)", paddingHorizontal: 13, paddingVertical: 11, shadowColor: colors.forestDeep, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.13, shadowRadius: 15, elevation: 4 },
  mapRouteCardSelected: { borderColor: colors.accent, borderWidth: 1.5 },
  mapRouteCardBody: { flex: 1 },
  mapRouteCardTopline: { minHeight: 36, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  mapRouteCardTitleRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 1 },
  mapRouteCardLabel: { flexShrink: 1, color: colors.ink, fontSize: 16, lineHeight: 20, fontWeight: "900" },
  mapRouteCardNumbers: { minWidth: 64, alignItems: "flex-end" },
  mapRouteCardTime: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "900" },
  mapRouteCardDistance: { color: colors.moss, fontSize: 9, lineHeight: 12, fontWeight: "800", marginTop: 1 },
  mapRouteCardRationale: { color: colors.textMuted, fontSize: 10, lineHeight: 14, fontWeight: "600", marginTop: 2 },
  mapRouteCardFooter: { flex: 1, minHeight: 18, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  routeCardIndex: { color: colors.accent, fontSize: 8, lineHeight: 11, letterSpacing: 0.7, fontWeight: "900" },
  mapRouteTraits: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  mapRankingDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.accent, marginHorizontal: 1 },
  mapRankingText: { color: colors.moss, fontSize: 7, lineHeight: 10, letterSpacing: 0.5, fontWeight: "900" },
  mapRouteLoading: { position: "absolute", left: 12, right: 12, bottom: 12, height: 92, borderRadius: 20, backgroundColor: "rgba(252,251,248,0.97)", paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: "rgba(17,18,15,0.13)" },
  mapRouteLoadingIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  mapRouteLoadingEyebrow: { color: colors.accent, fontSize: 8, lineHeight: 11, letterSpacing: 0.8, fontWeight: "900" },
  mapRouteLoadingTitle: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "800", marginTop: 2 },
  mapRouteLoadingSteps: { flexDirection: "row", gap: 3 },
  mapRouteLoadingStep: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.line },
  mapRouteLoadingStepActive: { width: 13, backgroundColor: colors.accent },
  routePreviewNotice: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.sageSoft, borderRadius: radii.medium, padding: 12, marginBottom: 12 },
  routePreviewNoticeText: { flex: 1, color: colors.forest, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  routeOriginNotice: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: colors.sageSoft, borderRadius: radii.medium, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 12 },
  routeOriginNoticeText: { flex: 1, color: colors.forest, fontSize: 10, lineHeight: 14, fontWeight: "600" },
  liveLocationButton: { minHeight: 44, maxWidth: 76, justifyContent: "center", alignItems: "flex-end" },
  liveLocationButtonText: { color: colors.accent, fontSize: 10, lineHeight: 14, fontWeight: "900", textAlign: "right" },
  retryRoute: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", marginTop: 2 },
  retryRouteText: { color: colors.accent, fontSize: 13, fontWeight: "800" },
  routeOptionsSection: { marginBottom: spacing.lg, backgroundColor: colors.paper, borderRadius: radii.large, borderWidth: 1, borderColor: colors.line, padding: 14 },
  routeOptionsHeader: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 2, marginBottom: 10 },
  routeOptionsTitle: { color: colors.ink, fontSize: 18, lineHeight: 22, fontWeight: "800" },
  rankingPill: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, borderRadius: radii.pill, backgroundColor: colors.accentSoft },
  rankingPillText: { color: colors.accent, fontSize: 10, lineHeight: 14, fontWeight: "900" },
  routeOptionsList: { gap: 8 },
  routeOption: { minHeight: 104, flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream, padding: 12 },
  routeOptionSelected: { borderColor: colors.accent, backgroundColor: "#FFF7F2" },
  routeOptionPressed: { opacity: 0.82 },
  routeRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.moss, alignItems: "center", justifyContent: "center", marginTop: 1 },
  routeRadioSelected: { borderColor: colors.accent },
  routeRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  routeOptionBody: { flex: 1, minWidth: 0 },
  routeOptionTopline: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 20 },
  routeOptionLabel: { flexShrink: 1, color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  recommendedPill: { borderRadius: radii.pill, backgroundColor: colors.forestDeep, paddingHorizontal: 6, paddingVertical: 3 },
  recommendedPillText: { color: colors.white, fontSize: 7, lineHeight: 9, letterSpacing: 0.7, fontWeight: "900" },
  routeOptionRationale: { color: colors.textMuted, fontSize: 11, lineHeight: 15, fontWeight: "600", marginTop: 3 },
  routeFacts: { minHeight: 19, flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 },
  routeTrait: { color: colors.forest, fontSize: 8, lineHeight: 12, letterSpacing: 0.65, fontWeight: "900" },
  agentEvidence: { flexShrink: 1, color: colors.accent, fontSize: 10, lineHeight: 14, fontWeight: "800" },
  routeDelta: { color: colors.moss, fontSize: 10, lineHeight: 14, fontWeight: "800" },
  routeOptionNumbers: { width: 62, alignItems: "flex-end", paddingTop: 1 },
  routeOptionTime: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "900", textAlign: "right" },
  routeOptionDistance: { color: colors.moss, fontSize: 10, lineHeight: 14, fontWeight: "700", marginTop: 2 },
  routeOptionsFootnote: { color: colors.textMuted, fontSize: 10, lineHeight: 15, fontWeight: "600", marginTop: 10, paddingHorizontal: 2 },
  routeOptionSkeleton: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: radii.medium, backgroundColor: colors.cream, padding: 12 },
  skeletonRadio: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.line },
  skeletonLine: { height: 11, borderRadius: 6, backgroundColor: colors.mapWash },
  skeletonLineMuted: { width: "88%", opacity: 0.55 },
  routeCard: { backgroundColor: colors.sageSoft, borderRadius: radii.xl, padding: 20, flexDirection: "row", gap: 16, alignItems: "center" },
  routeLine: { width: 30, height: 72, alignItems: "center" },
  dot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.forest },
  dotEnd: { backgroundColor: colors.coral },
  line: { width: 2, flex: 1, backgroundColor: colors.forest, opacity: 0.35 },
  routeLabel: { color: colors.moss, fontSize: 10, fontWeight: "900", letterSpacing: 1.1, marginBottom: 5, textTransform: "uppercase" },
  origin: { marginTop: 6, color: colors.forest },
  preferenceApplied: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, paddingTop: 10 },
  preferenceAppliedText: { flex: 1, color: colors.forest, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  metrics: { marginTop: spacing.lg, backgroundColor: colors.paper, borderRadius: radii.large, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  metric: { minHeight: 72, flexDirection: "row", gap: 12, alignItems: "center", paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  metricIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  metricValue: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  buddy: { marginTop: spacing.lg, backgroundColor: colors.forestDeep, borderRadius: radii.large, padding: 17, flexDirection: "row", gap: 12 },
  buddyIcon: { width: 43, height: 43, borderRadius: 15, backgroundColor: colors.forest, alignItems: "center", justifyContent: "center" },
  buddyEyebrow: { color: colors.lime, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  buddyTitle: { color: colors.white, fontSize: 16, fontWeight: "800", marginTop: 3 },
  buddyCopy: { color: colors.mint, fontSize: 12, lineHeight: 17, marginTop: 4 },
  agentBrief: { color: colors.white, fontSize: 13, lineHeight: 18, marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#34353C" },
  note: { marginTop: spacing.lg, backgroundColor: colors.paper, borderRadius: radii.large, borderWidth: 1, borderColor: colors.line, padding: 18 },
  privacy: { flexDirection: "row", gap: 10, alignItems: "center", marginVertical: spacing.lg, paddingHorizontal: 4 },
  error: { color: colors.danger, fontWeight: "600", marginVertical: 12 },
  plannedActions: { gap: 8, paddingBottom: spacing.md },
});
