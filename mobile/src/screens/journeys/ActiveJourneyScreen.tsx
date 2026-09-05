import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import TurtleMapSearch, { type RouteCoordinate } from "../../../modules/turtle-map-search";
import { api, ApiError } from "../../api/client";
import { AppButton } from "../../components/AppButton";
import { LoadingView } from "../../components/LoadingView";
import { Screen } from "../../components/Screen";
import { StatusPill } from "../../components/StatusPill";
import { resumeJourneyLocation, stopJourneyLocation } from "../../location/background";
import { resolveCurrentRouteOrigin } from "../../location/routeOrigin";
import { rebuildActiveRoute } from "../../routing/activeRoute";
import { decodeRoutePolyline, destinationCoordinate, navigationManeuver, routeNavigationGeometry, routeProgress, smoothBearing } from "../../routing/routeGeometry";
import { colors, radii, spacing, typography } from "../../theme";
import type { AppStackParamList, Journey, SelectedRouteNavigationStep, SelectedRouteWaypoint, TravelMode } from "../../types";
import { formatCountdown, formatDateTime, uuid } from "../../utils";

export function ActiveJourneyScreen({ route, navigation }: NativeStackScreenProps<AppStackParamList, "ActiveJourney">) {
  const [journey, setJourney] = useState<Journey>();
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string>();
  const [error, setError] = useState<string>();
  const [locationMonitoring, setLocationMonitoring] = useState<{ foreground: boolean; background: boolean }>();
  const [routeCoordinates, setRouteCoordinates] = useState<RouteCoordinate[]>([]);
  const [routeWaypoints, setRouteWaypoints] = useState<SelectedRouteWaypoint[]>([]);
  const [navigationSteps, setNavigationSteps] = useState<SelectedRouteNavigationStep[]>([]);
  const [routeMapLoading, setRouteMapLoading] = useState(true);
  const [routeMapNotice, setRouteMapNotice] = useState<string>();
  const [routeMapError, setRouteMapError] = useState<string>();
  const [routeReloadKey, setRouteReloadKey] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [userCoordinate, setUserCoordinate] = useState<RouteCoordinate>();
  const [followingUser, setFollowingUser] = useState(false);
  const [navigationMode, setNavigationMode] = useState(false);
  const [navigationHeading, setNavigationHeading] = useState(0);
  const [navigationSpeedMps, setNavigationSpeedMps] = useState(0);
  const [navigationAccuracyMeters, setNavigationAccuracyMeters] = useState<number>();
  const [navigationGpsState, setNavigationGpsState] = useState<"idle" | "acquiring" | "live" | "poor" | "unavailable">("idle");
  const [rerouting, setRerouting] = useState(false);
  const [routeMetrics, setRouteMetrics] = useState<{ distanceMeters: number; durationSeconds: number }>();
  const [controlsOpen, setControlsOpen] = useState(false);
  const [, tick] = useState(0);
  const mapRef = useRef<MapView>(null);
  const lastHeadingRef = useRef<number | undefined>(undefined);
  const offRouteSinceRef = useRef<number | undefined>(undefined);
  const lastRerouteAtRef = useRef(0);
  const rerouteGenerationRef = useRef(0);
  const { height: viewportHeight } = useWindowDimensions();
  const mapHeight = Math.min(440, Math.max(340, viewportHeight * 0.43));

  const load = async () => {
    try { setJourney(await api.journey(route.params.journeyId)); }
    catch (value) { setError((value as ApiError).message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => { tick((value) => value + 1); void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [route.params.journeyId]);

  useEffect(() => {
    void resumeJourneyLocation(route.params.journeyId)
      .then(setLocationMonitoring)
      .catch(() => setLocationMonitoring({ foreground: false, background: false }));
  }, [route.params.journeyId]);

  useEffect(() => {
    if (!journey?.destinationCoordinate) return;
    const destinationCoordinate = journey.destinationCoordinate;
    let cancelled = false;
    const loadRoute = async () => {
      setRouteMapLoading(true);
      setRouteMapError(undefined);
      setRouteMapNotice(undefined);
      const selectedRoute = journey.preferences.selectedRoute;
      const persistedCoordinates = decodeRoutePolyline(selectedRoute?.routePolyline);
      const persistedNavigationSteps = selectedRoute?.navigationSteps ?? [];
      if (persistedCoordinates.length >= 2 && persistedNavigationSteps.length > 0) {
        if (!cancelled) {
          setRouteCoordinates(persistedCoordinates);
          setRouteWaypoints(selectedRoute?.routeWaypoints ?? []);
          setNavigationSteps(persistedNavigationSteps);
          setRouteMetrics({
            distanceMeters: journey.routeDistanceMeters ?? selectedRoute?.distanceMeters ?? 0,
            durationSeconds: journey.routeDurationSeconds ?? selectedRoute?.durationSeconds ?? 0,
          });
          setRouteMapLoading(false);
        }
        return;
      }

      if (persistedCoordinates.length >= 2 && !cancelled) {
        setRouteCoordinates(persistedCoordinates);
        setRouteWaypoints(selectedRoute?.routeWaypoints ?? []);
        setRouteMetrics({
          distanceMeters: journey.routeDistanceMeters ?? selectedRoute?.distanceMeters ?? 0,
          durationSeconds: journey.routeDurationSeconds ?? selectedRoute?.durationSeconds ?? 0,
        });
      }

      try {
        if (!TurtleMapSearch || typeof TurtleMapSearch.calculateRouteAlternatives !== "function") {
          throw new Error("The current development build cannot calculate the active route.");
        }
        let origin = userCoordinate;
        if (!origin) {
          try {
            origin = (await resolveCurrentRouteOrigin()).coordinate;
          } catch {
            const originLabel = journey.originLabel?.trim();
            const geocoded = originLabel && originLabel.toLocaleLowerCase("en-US") !== "current location"
              ? await Location.geocodeAsync(originLabel).catch(() => [])
              : [];
            if (geocoded[0]) origin = { latitude: geocoded[0].latitude, longitude: geocoded[0].longitude };
          }
        }
        if (!origin) throw new Error("Turtle Maps needs location access to rebuild this older route.");
        const rebuilt = await rebuildActiveRoute({ mapSearch: TurtleMapSearch, journey, origin, destination: destinationCoordinate });
        if (!cancelled) {
          setRouteCoordinates(rebuilt.coordinates);
          setRouteWaypoints(rebuilt.waypoints);
          setNavigationSteps(rebuilt.navigationSteps);
          setRouteMetrics({ distanceMeters: rebuilt.distanceMeters, durationSeconds: rebuilt.durationSeconds });
          setRouteMapNotice(persistedCoordinates.length >= 2
            ? "Turtle refreshed turn guidance for this journey while keeping every selected stop."
            : "This journey was created before route lines were saved. Turtle rebuilt the remaining route through your selected stops.");
        }
      } catch (value) {
        if (!cancelled) {
          if (persistedCoordinates.length >= 2) setRouteMapNotice("The selected route is visible, but live maneuver details could not be refreshed yet.");
          else setRouteMapError(value instanceof Error ? value.message : "The active route could not be displayed.");
        }
      } finally {
        if (!cancelled) setRouteMapLoading(false);
      }
    };
    void loadRoute();
    return () => { cancelled = true; };
  }, [journey?.id, routeReloadKey]);

  useEffect(() => {
    if (!navigationMode) {
      setNavigationGpsState("idle");
      setNavigationAccuracyMeters(undefined);
      return;
    }

    let cancelled = false;
    let subscription: Location.LocationSubscription | undefined;
    const acceptLocation = (location: Location.LocationObject) => {
      if (cancelled) return;
      const coordinate = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      if (!Number.isFinite(coordinate.latitude) || !Number.isFinite(coordinate.longitude)) return;
      const geometry = routeNavigationGeometry(routeCoordinates, coordinate);
      const speed = Math.max(0, location.coords.speed ?? 0);
      const gpsHeading = location.coords.heading;
      const candidateHeading = typeof gpsHeading === "number" && gpsHeading >= 0 && speed >= 0.7
        ? gpsHeading
        : geometry?.routeBearing ?? lastHeadingRef.current ?? 0;
      const heading = smoothBearing(lastHeadingRef.current, candidateHeading, speed >= 7 ? 0.44 : 0.3);
      lastHeadingRef.current = heading;
      setNavigationHeading(heading);
      setNavigationSpeedMps(speed);
      setNavigationAccuracyMeters(location.coords.accuracy ?? undefined);
      setNavigationGpsState((location.coords.accuracy ?? 0) > 65 ? "poor" : "live");
      setUserCoordinate(coordinate);
    };

    const startGps = async () => {
      setNavigationGpsState("acquiring");
      const existing = await Location.getForegroundPermissionsAsync();
      const permission = existing.granted ? existing : await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        if (!cancelled) setNavigationGpsState("unavailable");
        return;
      }
      const recent = await Location.getLastKnownPositionAsync({ maxAge: 15_000, requiredAccuracy: 150 }).catch(() => null);
      if (recent) acceptLocation(recent);
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 1_000 },
        acceptLocation,
        () => { if (!cancelled) setNavigationGpsState("unavailable"); },
      );
      if (cancelled) subscription.remove();
    };
    void startGps().catch(() => { if (!cancelled) setNavigationGpsState("unavailable"); });
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [navigationMode, routeCoordinates]);

  useEffect(() => () => { rerouteGenerationRef.current += 1; }, []);

  useEffect(() => {
    if (!navigationMode || !journey?.destinationCoordinate || !userCoordinate || routeCoordinates.length < 2 || rerouting) return;
    const geometry = routeNavigationGeometry(routeCoordinates, userCoordinate);
    if (!geometry) return;
    const baseThreshold = journey.travelMode === "walking" ? 45 : journey.travelMode === "cycling" ? 60 : 85;
    const rerouteThreshold = Math.max(baseThreshold, (navigationAccuracyMeters ?? 0) * 1.5);
    if (geometry.offRouteMeters <= rerouteThreshold) {
      offRouteSinceRef.current = undefined;
      return;
    }
    const now = Date.now();
    if (!offRouteSinceRef.current) {
      offRouteSinceRef.current = now;
      return;
    }
    if (now - offRouteSinceRef.current < 8_000 || now - lastRerouteAtRef.current < 45_000) return;
    if (!TurtleMapSearch || typeof TurtleMapSearch.calculateRouteAlternatives !== "function") return;

    lastRerouteAtRef.current = now;
    const generation = ++rerouteGenerationRef.current;
    const remainingWaypoints = routeWaypoints.filter((waypoint) => {
      const waypointGeometry = routeNavigationGeometry(routeCoordinates, { latitude: waypoint.latitude, longitude: waypoint.longitude });
      return !waypointGeometry || waypointGeometry.progressDistanceMeters > geometry.progressDistanceMeters + 60;
    });
    setRerouting(true);
    void rebuildActiveRoute({
      mapSearch: TurtleMapSearch,
      journey,
      origin: userCoordinate,
      destination: journey.destinationCoordinate,
      resolvedWaypoints: remainingWaypoints,
    }).then((rebuilt) => {
      if (generation !== rerouteGenerationRef.current) return;
      setRouteCoordinates(rebuilt.coordinates);
      setRouteWaypoints(rebuilt.waypoints);
      setNavigationSteps(rebuilt.navigationSteps);
      setRouteMetrics({ distanceMeters: rebuilt.distanceMeters, durationSeconds: rebuilt.durationSeconds });
      setRouteMapNotice("Route updated from your live GPS position.");
      offRouteSinceRef.current = undefined;
    }).catch(() => {
      if (generation === rerouteGenerationRef.current) setRouteMapNotice("Turtle Maps could not update the route yet. Continue toward the highlighted route.");
    }).finally(() => {
      if (generation === rerouteGenerationRef.current) setRerouting(false);
    });
  }, [journey, navigationAccuracyMeters, navigationMode, rerouting, routeCoordinates, routeWaypoints, userCoordinate]);

  useEffect(() => {
    if (!mapReady || routeCoordinates.length < 2) return;
    const timer = setTimeout(() => {
      if (navigationMode && followingUser && userCoordinate) {
        focusNavigationCamera(mapRef.current, userCoordinate, navigationHeading, journey?.travelMode ?? "driving", navigationSpeedMps);
      } else {
        fitRoute(mapRef.current, routeCoordinates, routeWaypoints, navigationMode);
      }
    }, navigationMode ? 40 : 120);
    return () => clearTimeout(timer);
  }, [followingUser, journey?.travelMode, mapReady, navigationHeading, navigationMode, navigationSpeedMps, routeCoordinates, routeWaypoints, userCoordinate]);

  if (loading) return <LoadingView label="Opening your active journey..." />;
  if (!journey) return <Screen><Text style={styles.error}>{error ?? "Journey not found."}</Text></Screen>;

  const checkedIn = async () => {
    setAction("checkin"); setError(undefined);
    try { setJourney(await api.checkIn(journey.id)); await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
    catch (value) { setError((value as ApiError).message); }
    finally { setAction(undefined); }
  };
  const extend = () => Alert.alert("Need more time?", "Extend your expected arrival by 30 minutes. Your safety circle will see the new status.", [{ text: "Cancel", style: "cancel" }, { text: "Add 30 minutes", onPress: async () => { setAction("extend"); setError(undefined); try { setJourney(await api.extendJourney(journey.id, new Date(new Date(journey.expectedArrivalAt).getTime() + 30 * 60_000).toISOString())); } catch (value) { setError((value as ApiError).message); } finally { setAction(undefined); } } }]);
  const end = () => Alert.alert("End this journey?", "Location sharing and pending escalations will stop.", [{ text: "Keep journey active", style: "cancel" }, { text: "End journey", style: "destructive", onPress: async () => { setAction("end"); setError(undefined); try { await api.endJourney(journey.id); } catch (value) { setError((value as ApiError).message); setAction(undefined); return; } let locationStopped = true; try { await stopJourneyLocation(); } catch { locationStopped = false; } setAction(undefined); navigation.popToTop(); if (!locationStopped) Alert.alert("Journey ended", "The server ended the journey, but this device could not confirm that background location stopped. Close the app or review Location access in Settings."); } }]);
  const share = async () => {
    setAction("share"); setError(undefined);
    try {
      const result = await api.resendShareInvites(journey.id);
      Alert.alert("Private invites queued", `${result.recipientCount} ${result.recipientCount === 1 ? "person" : "people"} will receive their own account-gated commute link by the channels you selected.`);
    } catch (value) { setError((value as ApiError).message); }
    finally { setAction(undefined); }
  };
  const call = async () => { setAction("call"); setError(undefined); try { const result = await api.callMe(journey.id, uuid()); if (result.deliveryMode === "live") Alert.alert("Call queued", "Turtle Maps will call the phone number on your profile."); else Alert.alert("Call simulation recorded", "Voice delivery is not configured in this build, so no external call was placed."); } catch (value) { setError((value as ApiError).message); } finally { setAction(undefined); } };
  const alertPeople = () => Alert.alert("Alert your selected people?", "They will receive the manual journey alert you approved. This does not contact emergency services.", [{ text: "Cancel", style: "cancel" }, { text: "Send alert", style: "destructive", onPress: async () => { setAction("alert"); setError(undefined); try { const result = await api.alertCircle(journey.id, uuid()); if (result.deliveryMode === "live") Alert.alert("Alert queued", `Delivery was queued for ${result.recipientCount} ${result.recipientCount === 1 ? "person" : "people"}.`); else if (result.deliveryMode === "mixed") Alert.alert("Alert partly queued", "Some selected channels are live and others are still simulated. Review the server provider configuration before relying on this alert."); else Alert.alert("Alert simulation recorded", `The alert was recorded for ${result.recipientCount} ${result.recipientCount === 1 ? "person" : "people"}, but external SMS and email delivery are not configured in this build.`); } catch (value) { setError((value as ApiError).message); } finally { setAction(undefined); } } }]);
  const simulateUpdate = async () => { setAction("update"); setError(undefined); try { const result = await api.simulateCompanionUpdate(journey.id, uuid()); await load(); Alert.alert("Route update queued", `Development test queued for ${result.channels.join(" and ")}. Provider delivery remains controlled by backend configuration.`); } catch (value) { setError((value as ApiError).message); } finally { setAction(undefined); } };
  const overdue = journey.status === "overdue" || (journey.nextCheckInAt ? new Date(journey.nextCheckInAt).getTime() <= Date.now() : false);
  const selectedRoute = journey.preferences.selectedRoute;
  const progress = routeProgress({
    routeCoordinates,
    currentCoordinate: userCoordinate,
    plannedDistanceMeters: routeMetrics?.distanceMeters ?? journey.routeDistanceMeters ?? selectedRoute?.distanceMeters ?? 0,
    plannedDurationSeconds: routeMetrics?.durationSeconds ?? journey.routeDurationSeconds ?? selectedRoute?.durationSeconds ?? 0,
    waypoints: routeWaypoints,
  });
  const nextStop = progress.nextWaypoint?.label ?? journey.destinationLabel;
  const maneuver = navigationManeuver({ routeCoordinates, currentCoordinate: userCoordinate, steps: navigationSteps });
  const locationUnmatched = progress.offRouteMeters !== null && progress.offRouteMeters > 100_000;
  const offRouteThreshold = Math.max(journey.travelMode === "walking" ? 45 : journey.travelMode === "cycling" ? 60 : 85, (navigationAccuracyMeters ?? 0) * 1.5);
  const offRoute = progress.offRouteMeters !== null && progress.offRouteMeters > offRouteThreshold;

  const recenter = async () => {
    try {
      const coordinate = userCoordinate ?? (await resolveCurrentRouteOrigin()).coordinate;
      setUserCoordinate(coordinate);
      setFollowingUser(true);
      if (navigationMode) {
        const geometry = routeNavigationGeometry(routeCoordinates, coordinate);
        const heading = geometry?.routeBearing ?? navigationHeading;
        lastHeadingRef.current = heading;
        setNavigationHeading(heading);
        focusNavigationCamera(mapRef.current, coordinate, heading, journey.travelMode, navigationSpeedMps);
      }
      else mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.018, longitudeDelta: 0.018 }, 450);
    } catch {
      Alert.alert("Location unavailable", "Allow location access to follow your position on the active route.");
    }
  };

  const startNavigation = async () => {
    setMapReady(false);
    setNavigationMode(true);
    setFollowingUser(true);
    setNavigationGpsState("acquiring");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const coordinate = userCoordinate ?? (await resolveCurrentRouteOrigin()).coordinate;
      setUserCoordinate(coordinate);
      const heading = routeNavigationGeometry(routeCoordinates, coordinate)?.routeBearing ?? navigationHeading;
      lastHeadingRef.current = heading;
      setNavigationHeading(heading);
    } catch {
      setNavigationGpsState("unavailable");
    }
  };

  if (navigationMode) {
    const instruction = rerouting
      ? "Updating the route from your live position"
      : navigationGpsState === "unavailable"
      ? "GPS unavailable · check Location access"
      : navigationGpsState === "acquiring"
      ? "Finding your live GPS position"
      : locationUnmatched
      ? "Finding the best route from your position"
      : offRoute
      ? "Return to the highlighted route"
      : maneuver?.step.instruction ?? `Continue to ${journey.destinationLabel}`;
    const instructionDistance = rerouting || navigationGpsState === "acquiring" || navigationGpsState === "unavailable" || locationUnmatched
      ? 0
      : offRoute
      ? progress.offRouteMeters ?? 0
      : maneuver?.distanceToManeuverMeters ?? progress.remainingDistanceMeters;
    return (
      <View style={styles.navigationScreen}>
        <StatusBar style="dark" />
        {journey.destinationCoordinate ? <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialCamera={navigationCamera(
            journey.travelMode,
            userCoordinate ?? routeCoordinates[0] ?? journey.destinationCoordinate,
            navigationHeading,
            navigationSpeedMps,
          )}
          onMapReady={() => setMapReady(true)}
          onPanDrag={() => setFollowingUser(false)}
          scrollEnabled
          zoomEnabled
          pitchEnabled
          rotateEnabled
          showsCompass={false}
          showsUserLocation={false}
          showsMyLocationButton={false}
          userInterfaceStyle="light"
        >
          {routeCoordinates.length >= 2 && <Polyline coordinates={routeCoordinates} strokeColor="rgba(17,18,15,0.34)" strokeWidth={13} lineCap="round" lineJoin="round" />}
          {progress.traveledCoordinates.length >= 2 && <Polyline coordinates={progress.traveledCoordinates} strokeColor="rgba(87,103,94,0.58)" strokeWidth={7} lineCap="round" lineJoin="round" />}
          {progress.remainingCoordinates.length >= 2 && <Polyline coordinates={progress.remainingCoordinates} strokeColor={colors.accent} strokeWidth={7} lineCap="round" lineJoin="round" />}
          {routeWaypoints.map((waypoint) => <Marker key={`${waypoint.label}-${waypoint.latitude}-${waypoint.longitude}`} coordinate={{ latitude: waypoint.latitude, longitude: waypoint.longitude }} title={waypoint.role === "required" ? `Via ${waypoint.label}` : waypoint.label} description={waypoint.purpose} pinColor={waypoint.role === "required" ? colors.forest : colors.coral} />)}
          <Marker coordinate={journey.destinationCoordinate} title={journey.destinationLabel} description="Destination" pinColor={colors.coral} />
          {userCoordinate && navigationAccuracyMeters !== undefined && navigationAccuracyMeters <= 200 && <Circle center={userCoordinate} radius={Math.max(8, navigationAccuracyMeters)} fillColor="rgba(40,126,102,0.12)" strokeColor="rgba(40,126,102,0.28)" strokeWidth={1} />}
          {userCoordinate && <Marker
            identifier="live-gps-position"
            accessibilityLabel="Live GPS position"
            coordinate={userCoordinate}
            centerOffset={{ x: 0, y: 0 }}
            rotation={journey.travelMode === "walking" ? 0 : navigationHeading}
            tracksViewChanges={false}
            zIndex={50}
          >
            <View style={[styles.navigationPuck, navigationGpsState === "poor" && styles.navigationPuckPoor]}>
              <Ionicons name={journey.travelMode === "walking" ? "walk" : journey.travelMode === "cycling" ? "bicycle" : "navigate"} size={22} color={colors.white} />
            </View>
          </Marker>}
        </MapView> : <View style={styles.mapFallback}><Ionicons name="map-outline" size={34} color={colors.mint} /><Text style={styles.mapFallbackText}>This journey does not have destination coordinates.</Text></View>}

        <View
          accessible
          accessibilityLabel={`In-app navigation to ${journey.destinationLabel}`}
          accessibilityValue={{ text: `${instruction}; ${navigationGpsLabel(navigationGpsState, navigationAccuracyMeters)}; ${followingUser ? "camera following live position" : "route overview"}` }}
          pointerEvents="none"
          style={styles.mapAccessibilityStatus}
        />
        <SafeAreaView edges={["top", "left", "right"]} pointerEvents="box-none" style={styles.navigationOverlay}>
          <View style={[styles.maneuverCard, offRoute && styles.maneuverCardOffRoute]}>
            <View style={styles.maneuverTopline}>
              <View style={styles.navigationLive}><View style={[styles.liveDot, navigationGpsState === "live" && styles.liveDotOn, navigationGpsState === "poor" && styles.liveDotPoor]} /><View><Text style={styles.navigationLiveText}>TURTLE MAPS · LIVE GUIDANCE</Text><Text style={styles.navigationGpsText}>{navigationGpsLabel(navigationGpsState, navigationAccuracyMeters)}</Text></View></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Exit navigation" onPress={() => { setNavigationMode(false); setFollowingUser(false); setMapReady(false); }} style={styles.exitNavigation}><Ionicons name="close" size={23} color={colors.forestDeep} /></Pressable>
            </View>
            <View style={styles.maneuverBody}>
              <View style={[styles.maneuverIcon, offRoute && styles.maneuverIconOffRoute]}>{rerouting ? <ActivityIndicator color={colors.white} /> : <Ionicons name={navigationGpsState === "unavailable" ? "location-outline" : locationUnmatched ? "navigate" : maneuverIcon(instruction, offRoute)} size={30} color={colors.white} />}</View>
              <View style={{ flex: 1 }}><Text style={styles.maneuverDistance}>{rerouting ? "Rerouting" : navigationGpsState === "acquiring" ? "GPS starting" : navigationGpsState === "unavailable" ? "Location needed" : locationUnmatched ? "Connecting route" : formatManeuverDistance(instructionDistance)}</Text><Text numberOfLines={2} style={styles.maneuverInstruction}>{instruction}</Text></View>
            </View>
            {maneuver?.upcomingStep && !offRoute && <Text numberOfLines={1} style={styles.upcomingInstruction}>Then · {maneuver.upcomingStep.instruction}</Text>}
          </View>

          <View style={styles.navigationMapControls}>
            <MapControl label="Show route overview" icon="map-outline" onPress={() => { setFollowingUser(false); fitRoute(mapRef.current, routeCoordinates, routeWaypoints, true); }} />
            <MapControl label="Follow my location" icon="navigate" active={followingUser} onPress={() => void recenter()} />
          </View>

          <View style={styles.navigationBottomCard}>
            <View style={styles.navigationMetrics}>
              <View><Text style={styles.navigationEta}>{formatArrivalTime(progress.remainingDurationSeconds)}</Text><Text style={styles.navigationMetricLabel}>ARRIVAL</Text></View>
              <View style={styles.navigationMetricDivider} />
              <View><Text style={styles.navigationMetricValue}>{formatRouteDuration(progress.remainingDurationSeconds)}</Text><Text style={styles.navigationMetricLabel}>TIME LEFT</Text></View>
              <View style={styles.navigationMetricDivider} />
              <View><Text style={styles.navigationMetricValue}>{formatCompactDistance(progress.remainingDistanceMeters)}</Text><Text style={styles.navigationMetricLabel}>DISTANCE</Text></View>
            </View>
            <Text numberOfLines={1} style={styles.navigationDestination}>{travelModeLabel(journey.travelMode)} · {selectedRoute?.label ?? "Selected route"} · {journey.destinationLabel}</Text>
            <View style={styles.navigationActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Check in that I am okay" onPress={() => void checkedIn()} style={({ pressed }) => [styles.navigationCheckIn, pressed && styles.controlPressed]}><Ionicons name="checkmark-circle" size={20} color={colors.white} /><Text style={styles.navigationCheckInText}>{action === "checkin" ? "Checking in…" : "I'm okay"}</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Journey controls" onPress={() => setControlsOpen(true)} style={({ pressed }) => [styles.journeyControlsButton, pressed && styles.controlPressed]}><Ionicons name="ellipsis-horizontal" size={22} color={colors.forestDeep} /><Text style={styles.journeyControlsText}>Journey controls</Text></Pressable>
            </View>
          </View>
        </SafeAreaView>

        <Modal visible={controlsOpen} transparent animationType="slide" onRequestClose={() => setControlsOpen(false)}>
          <View style={styles.controlsModal}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close journey controls" onPress={() => setControlsOpen(false)} style={styles.controlsBackdrop} />
            <SafeAreaView edges={["bottom", "left", "right"]} style={styles.controlsSheet}>
              <View style={styles.controlsHandle} />
              <View style={styles.controlsHeader}><View><Text style={styles.controlsEyebrow}>ACTIVE JOURNEY</Text><Text style={styles.controlsTitle}>Stay in control</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close journey controls" onPress={() => setControlsOpen(false)} style={styles.controlsClose}><Ionicons name="close" size={22} color={colors.forestDeep} /></Pressable></View>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.controlsContent}>
                <View style={[styles.compactCheckin, overdue && styles.compactCheckinOverdue]}><View style={{ flex: 1 }}><Text style={styles.compactCheckinLabel}>{overdue ? "CHECK-IN DUE" : "NEXT CHECK-IN"}</Text><Text style={styles.compactCheckinTime}>{formatCountdown(journey.nextCheckInAt)}</Text></View><Pressable accessibilityRole="button" onPress={() => void checkedIn()} style={styles.compactCheckinButton}><Text style={styles.compactCheckinButtonText}>I'm okay</Text></Pressable></View>
                <View style={styles.actions}>
                  <Action icon="time-outline" label="Add 30 min" onPress={extend} />
                  <Action icon="send-outline" label={action === "share" ? "Sending…" : "Resend invites"} onPress={() => void share()} />
                  <Action icon="call-outline" label="Call me now" onPress={() => void call()} />
                  <Action icon="people-outline" label="Alert my people" onPress={alertPeople} />
                </View>
                <AppButton label="End journey" variant="secondary" style={styles.controlsEnd} onPress={end} />
              </ScrollView>
            </SafeAreaView>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <Screen dark style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.top}><StatusPill label={overdue ? "Check-in due" : "Journey active"} tone={overdue ? "danger" : "accent"} /><AppButton label="End" variant="secondary" style={styles.endTop} onPress={end} /></View>
      <Text style={styles.destinationEyebrow}>ON THE WAY TO</Text>
      <Text style={styles.destination}>{journey.destinationLabel}</Text>

      <View style={[styles.map, { height: mapHeight }]}>
        {journey.destinationCoordinate ? <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={{ ...journey.destinationCoordinate, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
          onMapReady={() => setMapReady(true)}
          onPanDrag={() => setFollowingUser(false)}
          onUserLocationChange={(event) => {
            const coordinate = event.nativeEvent.coordinate;
            if (!coordinate || typeof coordinate.latitude !== "number" || typeof coordinate.longitude !== "number") return;
            const nextCoordinate = { latitude: coordinate.latitude, longitude: coordinate.longitude };
            setUserCoordinate(nextCoordinate);
            if (followingUser) mapRef.current?.animateToRegion({ ...nextCoordinate, latitudeDelta: 0.018, longitudeDelta: 0.018 }, 350);
          }}
          scrollEnabled
          zoomEnabled
          pitchEnabled
          rotateEnabled
          showsCompass={false}
          showsUserLocation={Boolean(locationMonitoring?.foreground)}
          showsMyLocationButton={false}
          userInterfaceStyle="light"
        >
          {routeCoordinates.length >= 2 && <Polyline coordinates={routeCoordinates} strokeColor="rgba(17,18,15,0.42)" strokeWidth={10} lineCap="round" lineJoin="round" />}
          {routeCoordinates.length >= 2 && <Polyline coordinates={routeCoordinates} strokeColor={colors.accent} strokeWidth={6} lineCap="round" lineJoin="round" />}
          {routeWaypoints.map((waypoint) => <Marker
            key={`${waypoint.label}-${waypoint.latitude}-${waypoint.longitude}`}
            coordinate={{ latitude: waypoint.latitude, longitude: waypoint.longitude }}
            title={waypoint.role === "required" ? `Via ${waypoint.label}` : waypoint.label}
            description={waypoint.purpose}
            pinColor={waypoint.role === "required" ? colors.forest : colors.coral}
          />)}
          <Marker coordinate={journey.destinationCoordinate} title={journey.destinationLabel} description="Destination" pinColor={colors.coral} />
        </MapView> : <View style={styles.mapFallback}><Ionicons name="map-outline" size={34} color={colors.mint} /><Text style={styles.mapFallbackText}>Destination map unavailable for this older journey</Text></View>}

        <View
          accessible
          accessibilityLabel={`Active route map to ${journey.destinationLabel}`}
          accessibilityValue={{ text: routeCoordinates.length >= 2 ? `Route visible with ${routeWaypoints.length} stops` : routeMapLoading ? "Route loading" : "Destination only" }}
          accessibilityState={{ busy: routeMapLoading }}
          pointerEvents="none"
          style={styles.mapAccessibilityStatus}
        />
        <View pointerEvents="none" style={styles.locationChip}><View style={[styles.liveDot, locationMonitoring?.foreground && styles.liveDotOn]} /><Text numberOfLines={1} style={styles.locationText}>{journey.lastCoarseArea ?? (locationMonitoring?.background ? "Live location · background on" : locationMonitoring?.foreground ? "Live while Turtle Maps is open" : locationMonitoring ? "Location sharing off" : "Checking location…")}</Text></View>
        <View style={styles.mapControls}>
          <MapControl label="Show full route" icon="map-outline" onPress={() => { setFollowingUser(false); fitRoute(mapRef.current, routeCoordinates, routeWaypoints); }} />
          <MapControl label="Recenter on me" icon="locate" active={followingUser} onPress={() => void recenter()} />
        </View>
        {routeMapLoading && <View pointerEvents="none" style={styles.mapLoading}><ActivityIndicator color={colors.accent} /><Text style={styles.mapLoadingText}>Loading your selected route…</Text></View>}
        <View pointerEvents="none" style={styles.routeSummary}>
          <View style={styles.routeSummaryTop}><View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.routeChoice}>{selectedRoute?.label ?? "Active route"}</Text><Text numberOfLines={1} style={styles.nextStop}>Next · {nextStop}</Text></View><View style={styles.routeNumbers}><Text style={styles.routeTime}>{formatRouteDuration(progress.remainingDurationSeconds)}</Text><Text style={styles.routeDistance}>{formatRouteDistance(progress.remainingDistanceMeters)}</Text></View></View>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(2, progress.progress * 100)}%` }]} /></View>
        </View>
      </View>

      {routeMapNotice && <RouteNotice icon="information-circle-outline" message={routeMapNotice} />}
      {routeMapError && <View style={styles.routeError}><Ionicons name="warning-outline" size={18} color={colors.coral} /><Text style={styles.routeErrorText}>{routeMapError}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry active route" onPress={() => setRouteReloadKey((value) => value + 1)} style={styles.retryButton}><Text style={styles.retryText}>Retry</Text></Pressable></View>}
      <AppButton label="Navigate in Turtle Maps" icon="navigate" variant="secondary" style={styles.externalDirections} disabled={routeCoordinates.length < 2} onPress={() => void startNavigation()} />

      <View style={[styles.checkinCard, overdue && styles.checkinOverdue]}>
        <Text style={[styles.eyebrow, overdue && styles.darkEyebrow]}>{overdue ? "YOUR SAFETY CIRCLE IS WAITING" : "NEXT CHECK-IN"}</Text>
        <Text style={[styles.countdown, overdue && styles.darkText]}>{formatCountdown(journey.nextCheckInAt)}</Text>
        <Text style={[styles.checkinCopy, overdue && styles.darkCopy]}>{overdue ? "Tap now to cancel the escalation and let everyone know you are okay." : `Expected arrival ${formatDateTime(journey.expectedArrivalAt)}`}</Text>
        <AppButton label="I’m okay — check in" icon="checkmark-circle" variant={overdue ? "dark" : "primary"} loading={action === "checkin"} onPress={() => void checkedIn()} />
      </View>

      {journey.companionUpdatesEnabled && <View style={styles.buddy}><View style={styles.buddyIcon}><Ionicons name="pulse" size={19} color={colors.coral} /></View><View style={{ flex: 1 }}><Text style={styles.buddyLabel}>ROUTE AGENT · {journey.travelMode.replace("_", " ").toUpperCase()}</Text><Text style={styles.buddyUpdate}>{journey.lastCompanionUpdate ?? (journey.deliveryCapabilities.routeUpdatesLive ? `Monitoring live timing. You will hear from Turtle only when a delay exceeds ${journey.updateDelayThresholdMinutes} minutes.` : "Live route monitoring is not configured in this build. Use the development test below to verify the in-app update flow.")}</Text>{journey.lastCompanionUpdateAt && <Text style={styles.buddyTime}>Updated {formatDateTime(journey.lastCompanionUpdateAt)}</Text>}</View></View>}
      <View style={styles.actions}>
        <Action icon="time-outline" label="Add 30 min" onPress={extend} />
        <Action icon="send-outline" label={action === "share" ? "Sending…" : "Resend invites"} onPress={() => void share()} />
        <Action icon="call-outline" label="Call me now" onPress={() => void call()} />
        <Action icon="people-outline" label="Alert my people" onPress={alertPeople} />
      </View>
      {__DEV__ && journey.companionUpdatesEnabled && <AppButton label="Test a route-agent update" icon="flask-outline" variant="secondary" loading={action === "update"} style={styles.testButton} onPress={() => void simulateUpdate()} />}
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.footer}><Ionicons name="shield-checkmark" size={18} color={colors.mint} /><Text style={styles.footerText}>{locationMonitoring?.background ? "Background location is active for this journey. " : locationMonitoring?.foreground ? "Location updates continue while the app is open. " : "Location monitoring is off. "}Each invite requires an account; trusted viewers see only a coarse area and check-in status.</Text></View>
    </Screen>
  );
}

function fitRoute(map: MapView | null, coordinates: RouteCoordinate[], waypoints: SelectedRouteWaypoint[], navigation = false): void {
  if (!map || coordinates.length < 2) return;
  map.fitToCoordinates([
    ...coordinates,
    ...waypoints.map((waypoint) => ({ latitude: waypoint.latitude, longitude: waypoint.longitude })),
  ], { animated: true, edgePadding: navigation ? { top: 250, right: 58, bottom: 230, left: 58 } : { top: 78, right: 58, bottom: 132, left: 58 } });
}

function focusNavigationCamera(map: MapView | null, coordinate: RouteCoordinate, heading: number, travelMode: TravelMode, speedMps: number): void {
  map?.animateCamera(navigationCamera(travelMode, coordinate, heading, speedMps), { duration: 720 });
}

function navigationCamera(travelMode: TravelMode, coordinate: RouteCoordinate, heading: number, speedMps: number) {
  const pedestrian = travelMode === "walking";
  const cycling = travelMode === "cycling";
  const publicTransport = ["public_transit", "bus", "subway", "train"].includes(travelMode);
  const forwardMeters = pedestrian ? 45 : cycling ? 85 : publicTransport ? 120 : Math.min(220, Math.max(115, 115 + speedMps * 6));
  return {
    center: destinationCoordinate(coordinate, heading, forwardMeters),
    heading,
    pitch: pedestrian ? 44 : cycling ? 50 : publicTransport ? 52 : 58,
    altitude: pedestrian ? 360 : cycling ? 500 : publicTransport ? 650 : Math.min(820, Math.max(560, 560 + speedMps * 16)),
  };
}

function maneuverIcon(instruction: string, offRoute: boolean): keyof typeof Ionicons.glyphMap {
  if (offRoute) return "return-up-back";
  const normalized = instruction.toLocaleLowerCase("en-US");
  if (/destination|arrive/.test(normalized)) return "flag";
  if (/u-turn|u turn/.test(normalized)) return "return-up-back";
  if (/roundabout/.test(normalized)) return "sync";
  if (/left/.test(normalized)) return "arrow-back";
  if (/right/.test(normalized)) return "arrow-forward";
  if (/merge/.test(normalized)) return "git-merge";
  return "arrow-up";
}

function formatManeuverDistance(meters: number): string {
  if (meters <= 25) return "Now";
  const feet = meters * 3.28084;
  if (feet < 1_000) return `In ${Math.max(50, Math.round(feet / 50) * 50)} ft`;
  const miles = meters / 1609.344;
  return `In ${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

function formatCompactDistance(meters: number): string {
  if (!meters) return "—";
  const miles = meters / 1609.344;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

function formatArrivalTime(remainingSeconds: number): string {
  if (!remainingSeconds) return "—";
  return new Date(Date.now() + remainingSeconds * 1_000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatRouteDuration(seconds: number): string {
  if (!seconds) return "—";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

function formatRouteDistance(meters: number): string {
  if (!meters) return "Route ready";
  const miles = meters / 1609.344;
  return miles < 10 ? `${miles.toFixed(1)} mi left` : `${Math.round(miles)} mi left`;
}

function navigationGpsLabel(state: "idle" | "acquiring" | "live" | "poor" | "unavailable", accuracyMeters?: number): string {
  if (state === "acquiring") return "ACQUIRING LIVE GPS";
  if (state === "unavailable") return "LOCATION ACCESS NEEDED";
  if (state === "poor") return accuracyMeters ? `WEAK GPS · ±${Math.round(accuracyMeters * 3.28084)} FT` : "WEAK GPS SIGNAL";
  if (state === "live") return accuracyMeters ? `LIVE GPS · ±${Math.max(10, Math.round(accuracyMeters * 3.28084 / 10) * 10)} FT` : "LIVE GPS";
  return "PREPARING NAVIGATION";
}

function travelModeLabel(travelMode: TravelMode): string {
  switch (travelMode) {
    case "walking": return "Walking";
    case "cycling": return "Cycling";
    case "bus": return "Bus";
    case "subway": return "Subway";
    case "train": return "Train";
    case "taxi": return "Taxi";
    case "rideshare": return "Rideshare";
    case "public_transit": return "Transit";
    default: return "Driving";
  }
}

function MapControl({ label, icon, active = false, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; active?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.mapControl, active && styles.mapControlActive, pressed && styles.controlPressed]}><Ionicons name={icon} size={21} color={active ? colors.white : colors.forestDeep} /></Pressable>;
}

function RouteNotice({ icon, message }: { icon: keyof typeof Ionicons.glyphMap; message: string }) {
  return <View style={styles.routeNotice}><Ionicons name={icon} size={18} color={colors.mint} /><Text style={styles.routeNoticeText}>{message}</Text></View>;
}

function Action({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }} style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}><Ionicons name={icon} size={21} color={colors.forest} /><Text style={styles.actionText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  navigationScreen: { flex: 1, backgroundColor: colors.mapWash },
  navigationOverlay: { flex: 1, paddingHorizontal: 14, justifyContent: "space-between", paddingBottom: 18 },
  maneuverCard: { backgroundColor: "rgba(252,251,248,0.97)", borderRadius: 28, padding: 15, shadowColor: colors.forestDeep, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 24, elevation: 8 },
  maneuverCardOffRoute: { borderWidth: 2, borderColor: colors.warning },
  maneuverTopline: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navigationLive: { flexDirection: "row", alignItems: "center", gap: 7 },
  navigationLiveText: { color: colors.moss, fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1.15 },
  navigationGpsText: { color: colors.forestDeep, fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 0.72, marginTop: 1 },
  navigationPuck: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.forestDeep, borderWidth: 4, borderColor: colors.white, alignItems: "center", justifyContent: "center", shadowColor: colors.forestDeep, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 7, elevation: 8 },
  navigationPuckPoor: { backgroundColor: colors.warning },
  exitNavigation: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  maneuverBody: { flexDirection: "row", alignItems: "center", gap: 13, marginTop: 5 },
  maneuverIcon: { width: 58, height: 58, borderRadius: 19, backgroundColor: colors.forestDeep, alignItems: "center", justifyContent: "center" },
  maneuverIconOffRoute: { backgroundColor: colors.warning },
  maneuverDistance: { color: colors.accent, fontSize: 12, lineHeight: 16, fontWeight: "900", letterSpacing: 0.5 },
  maneuverInstruction: { color: colors.forestDeep, fontSize: 21, lineHeight: 25, fontWeight: "900", letterSpacing: -0.35, marginTop: 1 },
  upcomingInstruction: { color: colors.moss, fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 12, paddingTop: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  navigationMapControls: { position: "absolute", right: 14, top: 230, gap: 10 },
  navigationBottomCard: { backgroundColor: "rgba(17,18,15,0.96)", borderRadius: 28, paddingHorizontal: 17, paddingTop: 16, paddingBottom: 15, shadowColor: colors.forestDeep, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.24, shadowRadius: 28, elevation: 10 },
  navigationMetrics: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  navigationEta: { color: colors.coral, fontSize: 22, lineHeight: 26, fontWeight: "900", letterSpacing: -0.4 },
  navigationMetricValue: { color: colors.white, fontSize: 19, lineHeight: 24, fontWeight: "900", letterSpacing: -0.3 },
  navigationMetricLabel: { color: colors.mint, fontSize: 8, lineHeight: 11, fontWeight: "900", letterSpacing: 1.1, marginTop: 2 },
  navigationMetricDivider: { width: StyleSheet.hairlineWidth, height: 35, backgroundColor: "rgba(255,255,255,0.18)" },
  navigationDestination: { color: colors.mint, fontSize: 11, lineHeight: 15, fontWeight: "700", marginTop: 12 },
  navigationActions: { flexDirection: "row", gap: 9, marginTop: 13 },
  navigationCheckIn: { minHeight: 48, flex: 0.85, borderRadius: 16, backgroundColor: colors.accent, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  navigationCheckInText: { color: colors.white, fontSize: 14, lineHeight: 18, fontWeight: "900" },
  journeyControlsButton: { minHeight: 48, flex: 1.45, borderRadius: 16, backgroundColor: colors.paper, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  journeyControlsText: { color: colors.forestDeep, fontSize: 13, lineHeight: 17, fontWeight: "900" },
  controlsModal: { flex: 1, justifyContent: "flex-end" },
  controlsBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(17,18,15,0.48)" },
  controlsSheet: { maxHeight: "72%", backgroundColor: colors.cream, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingHorizontal: 20, paddingTop: 10 },
  controlsHandle: { width: 42, height: 5, borderRadius: 3, backgroundColor: colors.line, alignSelf: "center", marginBottom: 13 },
  controlsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  controlsEyebrow: { color: colors.accent, fontSize: 9, lineHeight: 12, letterSpacing: 1.3, fontWeight: "900" },
  controlsTitle: { color: colors.forestDeep, fontSize: 26, lineHeight: 30, fontWeight: "900", letterSpacing: -0.6, marginTop: 2 },
  controlsClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center" },
  controlsContent: { paddingBottom: 20 },
  compactCheckin: { minHeight: 82, borderRadius: 22, backgroundColor: colors.paper, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderWidth: 1, borderColor: colors.line },
  compactCheckinOverdue: { backgroundColor: colors.accentSoft, borderColor: colors.coral },
  compactCheckinLabel: { color: colors.moss, fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1.1 },
  compactCheckinTime: { color: colors.forestDeep, fontSize: 25, lineHeight: 29, fontWeight: "900", marginTop: 2 },
  compactCheckinButton: { minWidth: 92, minHeight: 46, borderRadius: 15, backgroundColor: colors.forestDeep, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  compactCheckinButtonText: { color: colors.white, fontSize: 13, fontWeight: "900" },
  controlsEnd: { marginTop: 12 },
  screen: { paddingTop: 10 },
  top: { minHeight: 44, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  endTop: { minHeight: 44, paddingHorizontal: 17 },
  destinationEyebrow: { color: colors.mint, fontSize: 10, lineHeight: 14, letterSpacing: 1.5, fontWeight: "900", marginTop: 18 },
  destination: { ...typography.hero, color: colors.white, marginTop: 3, marginBottom: 15 },
  map: { borderRadius: radii.xl, backgroundColor: "#C9D5CD", overflow: "hidden", position: "relative", borderWidth: 1, borderColor: "#3B4B44" },
  mapFallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24, backgroundColor: "#143C32" },
  mapFallbackText: { color: colors.mint, fontSize: 13, lineHeight: 18, textAlign: "center" },
  mapAccessibilityStatus: { position: "absolute", left: 0, top: 0, width: 1, height: 1 },
  locationChip: { position: "absolute", left: 12, top: 12, maxWidth: "66%", minHeight: 34, backgroundColor: "rgba(252,251,248,0.96)", borderRadius: radii.pill, paddingHorizontal: 11, flexDirection: "row", gap: 7, alignItems: "center" },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.moss },
  liveDotOn: { backgroundColor: colors.success, shadowColor: colors.success, shadowOpacity: 0.45, shadowRadius: 5 },
  liveDotPoor: { backgroundColor: colors.warning },
  locationText: { flexShrink: 1, color: colors.forestDeep, fontSize: 10, lineHeight: 14, fontWeight: "800" },
  mapControls: { position: "absolute", right: 12, top: 12, gap: 9 },
  mapControl: { width: 46, height: 46, borderRadius: 16, backgroundColor: "rgba(252,251,248,0.97)", alignItems: "center", justifyContent: "center", shadowColor: colors.forestDeep, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.14, shadowRadius: 10, elevation: 4 },
  mapControlActive: { backgroundColor: colors.forestDeep },
  controlPressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
  mapLoading: { position: "absolute", left: 16, right: 16, top: "42%", minHeight: 52, borderRadius: 18, backgroundColor: "rgba(252,251,248,0.96)", paddingHorizontal: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  mapLoadingText: { color: colors.forestDeep, fontSize: 12, fontWeight: "800" },
  routeSummary: { position: "absolute", left: 12, right: 12, bottom: 12, minHeight: 82, borderRadius: 22, backgroundColor: "rgba(17,18,15,0.94)", paddingHorizontal: 15, paddingTop: 13, paddingBottom: 11 },
  routeSummaryTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  routeChoice: { color: colors.white, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  nextStop: { color: colors.mint, fontSize: 10, lineHeight: 14, fontWeight: "700", marginTop: 2 },
  routeNumbers: { alignItems: "flex-end" },
  routeTime: { color: colors.white, fontSize: 16, lineHeight: 19, fontWeight: "900" },
  routeDistance: { color: colors.mint, fontSize: 9, lineHeight: 12, fontWeight: "700", marginTop: 1 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.16)", overflow: "hidden", marginTop: 10 },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.coral },
  routeNotice: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, paddingVertical: 10, borderRadius: radii.medium, backgroundColor: "#24362F", borderWidth: 1, borderColor: "#3B5148", marginTop: 10 },
  routeNoticeText: { flex: 1, color: colors.mint, fontSize: 11, lineHeight: 16, fontWeight: "600" },
  routeError: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, borderRadius: radii.medium, backgroundColor: "#3A2420", borderWidth: 1, borderColor: "#694037", marginTop: 10 },
  routeErrorText: { flex: 1, color: "#FFD9CF", fontSize: 11, lineHeight: 16, fontWeight: "600" },
  retryButton: { minWidth: 52, minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  retryText: { color: colors.coral, fontSize: 12, fontWeight: "900" },
  externalDirections: { marginTop: 10 },
  buddy: { marginTop: 12, borderRadius: radii.large, backgroundColor: "#1B2A24", borderWidth: 1, borderColor: "#315A50", padding: 15, flexDirection: "row", gap: 11 },
  buddyIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.forestDeep, alignItems: "center", justifyContent: "center" },
  buddyLabel: { color: colors.coral, fontSize: 9, lineHeight: 13, letterSpacing: 1, fontWeight: "900" },
  buddyUpdate: { color: colors.white, fontSize: 13, lineHeight: 18, fontWeight: "600", marginTop: 4 },
  buddyTime: { color: colors.mint, fontSize: 10, marginTop: 5 },
  checkinCard: { marginTop: spacing.md, backgroundColor: colors.paper, borderRadius: radii.xl, padding: 21, gap: 10 },
  checkinOverdue: { backgroundColor: colors.coral },
  eyebrow: { ...typography.eyebrow, color: colors.moss },
  darkEyebrow: { color: colors.forestDeep },
  countdown: { fontSize: 48, lineHeight: 52, letterSpacing: -1.2, fontWeight: "800", color: colors.ink },
  darkText: { color: colors.forestDeep },
  checkinCopy: { ...typography.small, marginBottom: 5 },
  darkCopy: { color: colors.forestDeep },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  testButton: { marginTop: 10 },
  action: { width: "48%", flexGrow: 1, minHeight: 70, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", gap: 6 },
  actionPressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  actionText: { color: colors.forest, fontSize: 13, lineHeight: 16, fontWeight: "800", textAlign: "center" },
  error: { color: "#FFD4CA", fontWeight: "600", marginTop: 12 },
  footer: { flexDirection: "row", gap: 9, alignItems: "flex-start", marginTop: 18, paddingHorizontal: 4 },
  footerText: { ...typography.small, color: colors.mint, flex: 1 },
});
