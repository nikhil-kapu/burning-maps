import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MapView, { Marker, type MapType, type Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import TurtleMapSearch, { type PlaceSuggestion } from "../../../modules/turtle-map-search";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { colors } from "../../theme";
import type { AppStackParamList, Journey, SafetyContact, TravelMode } from "../../types";

const defaultRegion: Region = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.13,
  longitudeDelta: 0.13,
};

const routeBriefs: Array<{ label: string; icon: keyof typeof Ionicons.glyphMap; prompt: string }> = [
  { label: "Scenic & calm", icon: "leaf-outline", prompt: "Prefer a scenic, calm route and avoid highways where possible." },
  { label: "Coffee break in 90 min", icon: "cafe-outline", prompt: "Remind me to take a coffee break around 90 minutes into the journey." },
  { label: "Safer after dark", icon: "moon-outline", prompt: "If route timing changes after dark, suggest well-lit stops in populated areas." },
];

const quickModes: Array<{ value: TravelMode; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { value: "driving", label: "Driving", icon: "car-outline" },
  { value: "public_transit", label: "Transit", icon: "train-outline" },
  { value: "walking", label: "Walking", icon: "walk-outline" },
];

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const mapRef = useRef<MapView>(null);
  const mapRegionRef = useRef<Region>(defaultRegion);
  const searchQueryRef = useRef("");
  const { user } = useAuth();
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [contacts, setContacts] = useState<SafetyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [locationVisible, setLocationVisible] = useState(false);
  const [mapType, setMapType] = useState<MapType>("standard");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [destination, setDestination] = useState<{ label: string; coordinate: { latitude: number; longitude: number } }>();
  const [travelMode, setTravelMode] = useState<TravelMode>("driving");
  const [showModes, setShowModes] = useState(false);
  const [routeBrief, setRouteBrief] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const [nextJourneys, nextContacts] = await Promise.all([api.journeys(), api.contacts()]);
      setJourneys(nextJourneys);
      setContacts(nextContacts);
    } catch (value) {
      setError((value as ApiError).message ?? "Could not refresh Turtle Maps.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const active = journeys.find((journey) => journey.status === "active" || journey.status === "overdue");

  useEffect(() => {
    if (!active?.destinationCoordinate) return;
    mapRef.current?.animateToRegion({ ...active.destinationCoordinate, latitudeDelta: 0.075, longitudeDelta: 0.075 }, 600);
  }, [active?.id]);

  useEffect(() => {
    const mapSearch = TurtleMapSearch;
    if (!mapSearch) return;
    const suggestionsSubscription = mapSearch.addListener("onSuggestions", (event) => {
      if (event.query.trim() !== searchQueryRef.current.trim()) return;
      setSuggestions(event.suggestions);
      setSuggestionsLoading(false);
    });
    const errorSubscription = mapSearch.addListener("onSearchError", (event) => {
      if (event.query.trim() !== searchQueryRef.current.trim()) return;
      setSuggestions([]);
      setSuggestionsLoading(false);
    });
    return () => {
      suggestionsSubscription.remove();
      errorSubscription.remove();
      void mapSearch.clear();
    };
  }, []);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
    const query = searchQuery.trim();
    if (!searchOpen || query.length < 2) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      void TurtleMapSearch?.clear();
      return;
    }
    const mapSearch = TurtleMapSearch;
    if (!mapSearch) return;

    setSuggestionsLoading(true);
    const timer = setTimeout(() => {
      const region = mapRegionRef.current;
      void mapSearch.updateQuery(query, region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta);
    }, 120);
    return () => clearTimeout(timer);
  }, [searchOpen, searchQuery]);

  const beginSearch = (initialPrompt?: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (initialPrompt) setRouteBrief(initialPrompt);
    setSearchOpen(true);
  };

  const commitDestination = (label: string, coordinate: { latitude: number; longitude: number }) => {
    Keyboard.dismiss();
    void TurtleMapSearch?.clear();
    setSuggestions([]);
    setSuggestionsLoading(false);
    setSearchQuery(label);
    setDestination({ label, coordinate });
    setSearchOpen(false);
    setShowModes(false);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.055, longitudeDelta: 0.055 }, 550);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const chooseSuggestion = async (suggestion: PlaceSuggestion) => {
    if (!TurtleMapSearch || searching) return;
    setSearching(true);
    setError(undefined);
    try {
      const place = await TurtleMapSearch.resolveSuggestion(suggestion.id);
      commitDestination(place.label, { latitude: place.latitude, longitude: place.longitude });
    } catch {
      setError("That place could not be opened. Choose another suggestion or search the full address.");
    } finally {
      setSearching(false);
    }
  };

  const searchDestination = async () => {
    const query = searchQuery.trim();
    if (query.length < 2) return;
    setSearching(true);
    setError(undefined);
    Keyboard.dismiss();
    try {
      if (Platform.OS === "android") {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          setError("Location permission is needed for destination search on Android.");
          return;
        }
      }
      const matches = await Location.geocodeAsync(query);
      const match = matches[0];
      if (!match) {
        setError("We could not find that place. Try a city and state, landmark, or full address.");
        return;
      }
      commitDestination(query, { latitude: match.latitude, longitude: match.longitude });
    } catch {
      setError("Destination search is temporarily unavailable. Check your connection and try again.");
    } finally {
      setSearching(false);
    }
  };

  const submitSearch = () => {
    const firstSuggestion = suggestions[0];
    if (firstSuggestion && TurtleMapSearch) {
      void chooseSuggestion(firstSuggestion);
      return;
    }
    void searchDestination();
  };

  const openDetailedPlanner = () => {
    if (!destination) return;
    navigation.navigate("CreateJourney", {
      initialDestination: destination.label,
      initialDestinationCoordinate: destination.coordinate,
      ...(routeBrief.trim() ? { initialPrompt: routeBrief.trim() } : {}),
    });
  };

  const buildRoute = async () => {
    if (!destination || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const journey = await api.createJourney({
        title: `Trip to ${destination.label}`.slice(0, 80),
        originLabel: null,
        destinationLabel: destination.label.slice(0, 120),
        destinationCoordinate: destination.coordinate,
        travelMode,
        agentInstructions: routeBrief.trim() || null,
        companionUpdatesEnabled: true,
        companionCallEnabled: false,
        updateDelayThresholdMinutes: 15,
        expectedArrivalAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        checkInIntervalMinutes: 30,
        graceMinutes: 15,
        voiceCallEnabled: false,
        notes: null,
        contactIds: [],
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.navigate("JourneyDetail", { journeyId: journey.id });
    } catch (value) {
      setError((value as ApiError).message ?? "We could not build that route. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const centerOnUser = async () => {
    setLocating(true);
    setError(undefined);
    void Haptics.selectionAsync();
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError("Location is off. You can still move the map or search for a destination.");
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocationVisible(true);
      mapRef.current?.animateToRegion({
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        latitudeDelta: 0.045,
        longitudeDelta: 0.045,
      }, 550);
    } catch {
      setError("We could not find your location. Move the map manually and try again.");
    } finally {
      setLocating(false);
    }
  };

  const toggleMapType = () => {
    void Haptics.selectionAsync();
    setMapType((current) => current === "standard" ? "hybrid" : "standard");
  };

  return (
    <View style={styles.screen}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={defaultRegion}
        onRegionChangeComplete={(region) => { mapRegionRef.current = region; }}
        mapType={mapType}
        mapPadding={{ top: 118, right: 14, bottom: destination ? 340 : 238, left: 14 }}
        showsCompass={false}
        showsPointsOfInterests
        showsUserLocation={locationVisible}
        showsMyLocationButton={false}
        pitchEnabled={false}
        rotateEnabled={false}
        toolbarEnabled={false}
      >
        {destination && <Marker coordinate={destination.coordinate} title={destination.label} pinColor={colors.coral} />}
      </MapView>

      <SafeAreaView pointerEvents="box-none" edges={["top", "left", "right"]} style={styles.topOverlay}>
        {searchOpen ? (
          <>
            <View style={styles.searchBarExpanded}>
              <Ionicons name="search" size={21} color={colors.ink} />
              <TextInput
                accessibilityLabel="Search destination"
                autoFocus
                autoCapitalize="words"
                autoCorrect={false}
                spellCheck={false}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={submitSearch}
                placeholder="Search a place or address"
                placeholderTextColor={colors.textMuted}
                returnKeyType="search"
                style={styles.searchInput}
              />
              {(suggestionsLoading || searching) && <ActivityIndicator accessibilityLabel="Finding places" color={colors.accent} size="small" />}
              <Pressable accessibilityRole="button" accessibilityLabel="Close destination search" onPress={() => { Keyboard.dismiss(); void TurtleMapSearch?.clear(); setSuggestions([]); setSearchOpen(false); }} style={styles.searchClose}>
                <Ionicons name="close" size={20} color={colors.ink} />
              </Pressable>
            </View>
            {searchQuery.trim().length >= 2 && (
              <View accessibilityLabel="Place suggestions" style={styles.suggestionsPanel}>
                {suggestions.slice(0, 4).map((suggestion, index) => (
                  <Pressable
                    key={suggestion.id}
                    accessibilityRole="button"
                    accessibilityLabel={[suggestion.title, suggestion.subtitle].filter(Boolean).join(", ")}
                    disabled={searching}
                    onPress={() => void chooseSuggestion(suggestion)}
                    style={({ pressed }) => [styles.placeSuggestion, index > 0 && styles.suggestionDivider, pressed && styles.suggestionPressed]}
                  >
                    <View style={styles.suggestionIcon}><Ionicons name="location-outline" size={19} color={colors.accent} /></View>
                    <View style={styles.suggestionCopy}>
                      <Text numberOfLines={1} style={styles.suggestionTitle}>{suggestion.title}</Text>
                      {suggestion.subtitle ? <Text numberOfLines={1} style={styles.suggestionSubtitle}>{suggestion.subtitle}</Text> : null}
                    </View>
                    <Ionicons name="arrow-up-outline" size={17} color={colors.textMuted} style={styles.suggestionArrow} />
                  </Pressable>
                ))}

                {suggestionsLoading && suggestions.length === 0 ? (
                  <View accessibilityLabel="Finding likely places" style={styles.suggestionLoadingRow}>
                    <ActivityIndicator color={colors.accent} size="small" />
                    <Text style={styles.suggestionLoadingText}>Finding likely places…</Text>
                  </View>
                ) : (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Search for ${searchQuery.trim()}`} disabled={searching} onPress={() => void searchDestination()} style={({ pressed }) => [styles.searchAllRow, suggestions.length > 0 && styles.suggestionDivider, pressed && styles.suggestionPressed]}>
                    <View style={styles.searchAllIcon}><Ionicons name="search" size={17} color={colors.forest} /></View>
                    <Text numberOfLines={1} style={styles.searchAllText}>Search “{searchQuery.trim()}”</Text>
                    <Ionicons name="arrow-forward" size={18} color={colors.ink} />
                  </Pressable>
                )}

                {TurtleMapSearch && <View style={styles.suggestionSource}><Ionicons name="map-outline" size={12} color={colors.textMuted} /><Text style={styles.suggestionSourceText}>Suggestions from Apple Maps</Text></View>}
              </View>
            )}
          </>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Search a destination" onPress={() => beginSearch()} style={({ pressed }) => [styles.searchBar, pressed && styles.pressed]}>
            <Ionicons name="search" size={21} color={colors.ink} />
            <View style={styles.searchCopy}>
              <Text numberOfLines={1} style={styles.searchTitle}>{destination?.label ?? "Where to?"}</Text>
              <Text numberOfLines={1} style={styles.searchHint}>{destination ? "Tap to change destination" : "Search a place or address"}</Text>
            </View>
            <View style={styles.avatar}><Text style={styles.avatarText}>{user?.displayName.slice(0, 1).toUpperCase() ?? "T"}</Text></View>
          </Pressable>
        )}

        {!searchOpen && <View pointerEvents="none" style={styles.agentLens}>
          {loading ? <ActivityIndicator size="small" color={colors.accent} /> : <View style={styles.agentDot} />}
          <Ionicons name="sparkles" size={14} color={colors.accent} />
          <Text style={styles.agentLensText}>Turtle lens</Text>
          <Text style={styles.agentLensMeta}>{destination ? "route ready to shape" : "timing · check-ins · comfort"}</Text>
        </View>}
      </SafeAreaView>

      <View style={styles.mapControls}>
        <Pressable accessibilityRole="button" accessibilityLabel={mapType === "standard" ? "Show satellite map" : "Show standard map"} onPress={toggleMapType} style={({ pressed }) => [styles.mapControl, pressed && styles.pressed]}>
          <Ionicons name="layers-outline" size={22} color={colors.ink} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Center map on my location" onPress={() => void centerOnUser()} style={({ pressed }) => [styles.mapControl, pressed && styles.pressed]}>
          {locating ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="locate" size={22} color={colors.ink} />}
        </Pressable>
      </View>

      <View pointerEvents="box-none" style={styles.bottomOverlay}>
        {error && (
          <Pressable accessibilityRole="button" accessibilityLabel={`${error} Tap to dismiss.`} onPress={() => setError(undefined)} style={styles.errorToast}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
            <Text numberOfLines={2} style={styles.errorText}>{error}</Text>
          </Pressable>
        )}

        {destination ? (
          <View style={styles.routeDraft}>
            <View style={styles.dockHandle} />
            <View style={styles.routeDraftHeader}>
              <View style={styles.destinationPin}><Ionicons name="location" size={19} color={colors.white} /></View>
              <View style={styles.routeDraftCopy}>
                <Text style={styles.dockEyebrow}>DESTINATION SET</Text>
                <Text accessibilityLabel={`Selected destination ${destination.label}`} numberOfLines={1} style={styles.routeDraftTitle}>{destination.label}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Clear destination" onPress={() => { setDestination(undefined); setSearchQuery(""); setRouteBrief(""); }} style={styles.clearDestination}>
                <Ionicons name="close" size={19} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.smartDefaultsRow}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Travel mode ${travelMode}. Change mode`} onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setShowModes((value) => !value); }} style={({ pressed }) => [styles.modeDefault, pressed && styles.pressed]}>
                <Ionicons name={quickModes.find((mode) => mode.value === travelMode)?.icon ?? "navigate-outline"} size={17} color={colors.forest} />
                <Text style={styles.modeDefaultText}>{quickModes.find((mode) => mode.value === travelMode)?.label ?? "Driving"}</Text>
                <Ionicons name={showModes ? "chevron-up" : "chevron-down"} size={15} color={colors.textMuted} />
              </Pressable>
              <Text style={styles.defaultsHint}>Smart defaults applied</Text>
            </View>

            {showModes && <View style={styles.quickModeRow}>{quickModes.map((mode) => <Pressable key={mode.value} accessibilityRole="button" accessibilityState={{ selected: travelMode === mode.value }} onPress={() => { setTravelMode(mode.value); setShowModes(false); }} style={[styles.quickMode, travelMode === mode.value && styles.quickModeSelected]}><Ionicons name={mode.icon} size={16} color={travelMode === mode.value ? colors.white : colors.ink} /><Text style={[styles.quickModeText, travelMode === mode.value && styles.quickModeTextSelected]}>{mode.label}</Text></Pressable>)}</View>}

            <View style={styles.routeBriefBar}>
              <Ionicons name="sparkles" size={17} color={colors.accent} />
              <TextInput accessibilityLabel="Optional route preferences" value={routeBrief} onChangeText={setRouteBrief} maxLength={1500} placeholder="Optional: scenic, quiet, coffee in 90 min…" placeholderTextColor={colors.textMuted} returnKeyType="done" style={styles.routeBriefInput} />
            </View>

            <Pressable accessibilityRole="button" accessibilityLabel="Build route now" disabled={saving} onPress={() => void buildRoute()} style={({ pressed }) => [styles.buildRouteButton, pressed && styles.buildRouteButtonPressed, saving && styles.buildRouteButtonDisabled]}>
              <Text style={styles.buildRouteText}>{saving ? "Building your route…" : "Build route"}</Text>
              <View style={styles.buildRouteArrow}>{saving ? <ActivityIndicator color={colors.accent} size="small" /> : <Ionicons name="arrow-forward" size={20} color={colors.accent} />}</View>
            </Pressable>

            <Pressable accessibilityRole="button" accessibilityLabel="Trip options, updates and sharing" onPress={openDetailedPlanner} style={styles.moreOptions}>
              <Text style={styles.moreOptionsText}>Trip options, updates & sharing</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : active ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Open active journey to ${active.destinationLabel}`} onPress={() => navigation.navigate("ActiveJourney", { journeyId: active.id })} style={({ pressed }) => [styles.agentDock, pressed && styles.pressed]}>
            <View style={styles.dockHandle} />
            <View style={styles.activeHeader}>
              <View style={styles.agentOrb}><Ionicons name="pulse" size={19} color={colors.white} /></View>
              <View style={styles.activeCopy}>
                <Text style={styles.dockEyebrow}>{active.deliveryCapabilities.routeUpdatesLive ? "AGENT LIVE" : "JOURNEY ACTIVE"}</Text>
                <Text numberOfLines={1} style={styles.activeDestination}>{active.destinationLabel}</Text>
              </View>
              <View style={styles.openCircle}><Ionicons name="arrow-forward" size={20} color={colors.accent} /></View>
            </View>
            <Text style={styles.activeUpdate}>{active.lastCompanionUpdate ?? (active.deliveryCapabilities.routeUpdatesLive ? "Watching timing, route changes and your next check-in." : "Safety check-ins are active. Open your journey for live GPS navigation.")}</Text>
            <View style={styles.liveStatus}><View style={styles.liveDot} /><Text style={styles.liveStatusText}>Open location, check-in and journey controls</Text></View>
          </Pressable>
        ) : (
          <View style={styles.agentDock}>
            <View style={styles.dockHandle} />
            <View style={styles.dockHeader}>
              <View style={styles.agentOrb}><Ionicons name="sparkles" size={18} color={colors.white} /></View>
              <View style={styles.dockTitleCopy}>
                <Text style={styles.dockEyebrow}>PLAN WITH TURTLE</Text>
                <Text style={styles.dockTitle}>Describe the journey, not the filters.</Text>
              </View>
            </View>

            <Pressable accessibilityRole="button" accessibilityLabel="Tell Turtle what matters for this trip" onPress={() => beginSearch()} style={({ pressed }) => [styles.promptBar, pressed && styles.pressed]}>
              <Text numberOfLines={1} style={styles.promptText}>Scenic roads, a break reminder, fewer updates…</Text>
              <View style={styles.promptAction}><Ionicons name="arrow-up" size={19} color={colors.white} /></View>
            </Pressable>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.briefRow}>
              {routeBriefs.map((brief) => (
                <Pressable key={brief.label} accessibilityRole="button" accessibilityLabel={`Plan with preference: ${brief.label}`} onPress={() => beginSearch(brief.prompt)} style={({ pressed }) => [styles.briefChip, pressed && styles.pressed]}>
                  <Ionicons name={brief.icon} size={15} color={colors.ink} />
                  <Text style={styles.briefLabel}>{brief.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Pressable accessibilityRole="button" onPress={() => contacts.length === 0 ? navigation.navigate("AddContact") : navigation.navigate("Tabs", { screen: "Circle" })} style={styles.trustRow}>
              <Ionicons name={contacts.length === 0 ? "person-add-outline" : "people-outline"} size={17} color={colors.textMuted} />
              <Text style={styles.trustText}>{contacts.length === 0 ? "Add someone you trust before starting" : `${contacts.length} trusted ${contacts.length === 1 ? "person" : "people"} available for this journey`}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.mapWash },
  topOverlay: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 3, paddingHorizontal: 16, gap: 10 },
  searchBar: { minHeight: 62, borderRadius: 18, borderCurve: "continuous", backgroundColor: "rgba(252,251,248,0.97)", paddingLeft: 17, paddingRight: 9, flexDirection: "row", alignItems: "center", gap: 12, boxShadow: "0 5px 20px rgba(17,18,15,0.18)" },
  searchBarExpanded: { minHeight: 58, borderRadius: 18, borderCurve: "continuous", backgroundColor: "rgba(252,251,248,0.99)", paddingLeft: 17, paddingRight: 7, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderColor: colors.forest, boxShadow: "0 7px 24px rgba(17,18,15,0.2)" },
  searchInput: { flex: 1, minHeight: 54, color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "700", paddingVertical: 0 },
  searchClose: { width: 44, height: 44, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  suggestionsPanel: { borderRadius: 18, borderCurve: "continuous", overflow: "hidden", backgroundColor: "rgba(252,251,248,0.99)", paddingHorizontal: 10, boxShadow: "0 7px 24px rgba(17,18,15,0.19)" },
  placeSuggestion: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 2 },
  suggestionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  suggestionPressed: { backgroundColor: colors.cream },
  suggestionIcon: { width: 40, height: 40, borderRadius: 13, borderCurve: "continuous", backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  suggestionCopy: { flex: 1, minWidth: 0 },
  suggestionTitle: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: "800" },
  suggestionSubtitle: { color: colors.textMuted, fontSize: 11, lineHeight: 15, paddingTop: 2 },
  suggestionArrow: { transform: [{ rotate: "45deg" }] },
  suggestionLoadingRow: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  suggestionLoadingText: { color: colors.textMuted, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  searchAllRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 },
  searchAllIcon: { width: 34, height: 34, borderRadius: 12, borderCurve: "continuous", backgroundColor: colors.sageSoft, alignItems: "center", justifyContent: "center" },
  searchAllText: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  suggestionSource: { minHeight: 26, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  suggestionSourceText: { color: colors.textMuted, fontSize: 9, lineHeight: 12, fontWeight: "600" },
  searchCopy: { flex: 1, minWidth: 0 },
  searchTitle: { color: colors.ink, fontSize: 16, lineHeight: 20, fontWeight: "800" },
  searchHint: { color: colors.textMuted, fontSize: 12, lineHeight: 16, paddingTop: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.sand, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.forestDeep, fontSize: 16, fontWeight: "900" },
  agentLens: { alignSelf: "flex-start", minHeight: 34, borderRadius: 17, backgroundColor: "rgba(252,251,248,0.94)", paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 6, boxShadow: "0 3px 12px rgba(17,18,15,0.12)" },
  agentDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  agentLensText: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  agentLensMeta: { color: colors.textMuted, fontSize: 10, fontWeight: "600" },
  mapControls: { position: "absolute", top: 200, right: 16, zIndex: 2, gap: 9 },
  mapControl: { width: 48, height: 48, borderRadius: 14, borderCurve: "continuous", backgroundColor: "rgba(252,251,248,0.97)", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(17,18,15,0.18)" },
  bottomOverlay: { position: "absolute", left: 12, right: 12, bottom: 12, gap: 8 },
  errorToast: { minHeight: 48, borderRadius: 14, borderCurve: "continuous", backgroundColor: "rgba(252,251,248,0.97)", paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 9, boxShadow: "0 4px 16px rgba(17,18,15,0.16)" },
  errorText: { color: colors.danger, flex: 1, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  agentDock: { borderRadius: 24, borderCurve: "continuous", backgroundColor: "rgba(252,251,248,0.98)", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 13, gap: 11, boxShadow: "0 10px 34px rgba(17,18,15,0.22)" },
  dockHandle: { width: 34, height: 4, borderRadius: 2, backgroundColor: colors.line, alignSelf: "center" },
  dockHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  dockTitleCopy: { flex: 1 },
  agentOrb: { width: 38, height: 38, borderRadius: 13, borderCurve: "continuous", backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  dockEyebrow: { color: colors.accent, fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1.1 },
  dockTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "800", paddingTop: 2 },
  promptBar: { minHeight: 50, borderRadius: 15, borderCurve: "continuous", backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, paddingLeft: 14, paddingRight: 6, flexDirection: "row", alignItems: "center", gap: 10 },
  promptText: { color: colors.textMuted, flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  promptAction: { width: 38, height: 38, borderRadius: 12, borderCurve: "continuous", backgroundColor: colors.forestDeep, alignItems: "center", justifyContent: "center" },
  briefRow: { gap: 8, paddingRight: 12 },
  briefChip: { minHeight: 36, borderRadius: 18, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 6 },
  briefLabel: { color: colors.ink, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  trustRow: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 2 },
  trustText: { color: colors.textMuted, flex: 1, fontSize: 10, lineHeight: 14, fontWeight: "600" },
  activeHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  activeCopy: { flex: 1 },
  activeDestination: { color: colors.ink, fontSize: 19, lineHeight: 24, fontWeight: "800", paddingTop: 1 },
  activeUpdate: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  openCircle: { width: 42, height: 42, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  liveStatus: { minHeight: 30, borderRadius: 15, backgroundColor: colors.sageSoft, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  liveStatusText: { color: colors.forest, fontSize: 10, lineHeight: 14, fontWeight: "700" },
  routeDraft: { borderRadius: 24, borderCurve: "continuous", backgroundColor: "rgba(252,251,248,0.99)", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 10, boxShadow: "0 10px 34px rgba(17,18,15,0.24)" },
  routeDraftHeader: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 11 },
  destinationPin: { width: 40, height: 40, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  routeDraftCopy: { flex: 1, minWidth: 0 },
  routeDraftTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "800", paddingTop: 1 },
  clearDestination: { width: 44, height: 44, borderRadius: 14, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
  smartDefaultsRow: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 10 },
  modeDefault: { minHeight: 34, borderRadius: 17, backgroundColor: colors.sageSoft, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  modeDefaultText: { color: colors.forest, fontSize: 11, lineHeight: 15, fontWeight: "800" },
  defaultsHint: { color: colors.textMuted, fontSize: 10, lineHeight: 14, fontWeight: "600" },
  quickModeRow: { flexDirection: "row", gap: 7 },
  quickMode: { minHeight: 38, borderRadius: 19, borderCurve: "continuous", paddingHorizontal: 12, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  quickModeSelected: { backgroundColor: colors.forestDeep, borderColor: colors.forestDeep },
  quickModeText: { color: colors.ink, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  quickModeTextSelected: { color: colors.white },
  routeBriefBar: { minHeight: 48, borderRadius: 15, borderCurve: "continuous", backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  routeBriefInput: { flex: 1, minHeight: 46, color: colors.ink, fontSize: 12, lineHeight: 17, fontWeight: "600", paddingVertical: 0 },
  buildRouteButton: { minHeight: 54, borderRadius: 17, borderCurve: "continuous", backgroundColor: colors.forestDeep, paddingLeft: 18, paddingRight: 7, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  buildRouteButtonPressed: { transform: [{ scale: 0.99 }], opacity: 0.94 },
  buildRouteButtonDisabled: { opacity: 0.7 },
  buildRouteText: { color: colors.white, fontSize: 15, lineHeight: 20, fontWeight: "800" },
  buildRouteArrow: { width: 42, height: 42, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.paper, alignItems: "center", justifyContent: "center" },
  moreOptions: { minHeight: 36, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  moreOptionsText: { color: colors.textMuted, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.9 },
});
