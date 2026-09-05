import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Location from "expo-location";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type TextInputProps } from "react-native";
import MapView, { type Region } from "react-native-maps";
import { api, ApiError } from "../../api/client";
import { LoadingView } from "../../components/LoadingView";
import { Screen } from "../../components/Screen";
import { colors } from "../../theme";
import type { AppStackParamList, SafetyContact, TravelMode } from "../../types";

const durations = [{ label: "30 min", minutes: 30 }, { label: "1 hour", minutes: 60 }, { label: "2 hours", minutes: 120 }, { label: "4 hours", minutes: 240 }];
const checkIns = [15, 30, 60, 120];
const initialRegion: Region = { latitude: 37.7749, longitude: -122.4194, latitudeDelta: 0.16, longitudeDelta: 0.16 };
const modes: Array<{ value: TravelMode; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { value: "driving", label: "Driving", icon: "car-sport-outline" },
  { value: "public_transit", label: "Transit", icon: "git-branch-outline" },
  { value: "bus", label: "Bus", icon: "bus-outline" },
  { value: "subway", label: "Subway", icon: "subway-outline" },
  { value: "train", label: "Train", icon: "train-outline" },
  { value: "taxi", label: "Taxi", icon: "car-outline" },
  { value: "rideshare", label: "Rideshare", icon: "people-outline" },
  { value: "walking", label: "Walking", icon: "walk-outline" },
  { value: "cycling", label: "Cycling", icon: "bicycle-outline" },
];

function placeLabel(place: Location.LocationGeocodedAddress | undefined): string | null {
  if (!place) return null;
  const first = place.name && place.name !== place.street ? place.name : place.street;
  return [first, place.city ?? place.subregion].filter(Boolean).join(", ") || null;
}

export function CreateJourneyScreen({ navigation, route }: NativeStackScreenProps<AppStackParamList, "CreateJourney">) {
  const mapRef = useRef<MapView>(null);
  const initialDestinationCoordinate = route.params?.initialDestinationCoordinate;
  const [title, setTitle] = useState("My journey");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState(route.params?.initialDestination ?? "");
  const [mapCenter, setMapCenter] = useState(initialDestinationCoordinate ?? { latitude: initialRegion.latitude, longitude: initialRegion.longitude });
  const [destinationCoordinate, setDestinationCoordinate] = useState<{ latitude: number; longitude: number } | undefined>(initialDestinationCoordinate);
  const [travelMode, setTravelMode] = useState<TravelMode>("driving");
  const [agentInstructions, setAgentInstructions] = useState(route.params?.initialPrompt ?? "");
  const [duration, setDuration] = useState(60);
  const [checkIn, setCheckIn] = useState(30);
  const [grace, setGrace] = useState(15);
  const [companionUpdates, setCompanionUpdates] = useState(true);
  const [companionCalls, setCompanionCalls] = useState(false);
  const [delayThreshold, setDelayThreshold] = useState(15);
  const [voice, setVoice] = useState(false);
  const [notes, setNotes] = useState("");
  const [contacts, setContacts] = useState<SafetyContact[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void api.contacts()
      .then((value) => {
        setContacts(value);
      })
      .catch((value: ApiError) => setError(value.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingView label="Preparing your journey..." />;

  const useCurrentLocation = async () => {
    setLocating(true); setError(undefined);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) return setError("Location permission is needed only to center the map on you. You can still choose a destination manually.");
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coordinate = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.045, longitudeDelta: 0.045 }, 500);
      if (!origin) {
        const places = await Location.reverseGeocodeAsync(coordinate).catch(() => []);
        setOrigin(placeLabel(places[0]) ?? "Current location");
      }
    } catch { setError("We could not find your location. Move the map manually and try again."); }
    finally { setLocating(false); }
  };

  const searchDestination = async () => {
    const query = destination.trim();
    if (query.length < 2) return setError("Search for a city, hotel, landmark, or address.");
    setSearching(true); setError(undefined); Keyboard.dismiss();
    try {
      if (Platform.OS === "android") {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) return setError("Android requires location permission for place search. You can still move the map and use the center flag.");
      }
      const matches = await Location.geocodeAsync(query);
      const match = matches[0];
      if (!match) return setError("We could not find that destination. Try a city and state, a full address, or move the map manually.");
      const coordinate = { latitude: match.latitude, longitude: match.longitude };
      setMapCenter(coordinate);
      setDestinationCoordinate(coordinate);
      mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.045, longitudeDelta: 0.045 }, 550);
      setDestination(query);
    } catch { setError("Destination search is temporarily unavailable. Move the map and use the center flag instead."); }
    finally { setSearching(false); }
  };

  const pinDestination = async () => {
    setPinning(true); setError(undefined); setDestinationCoordinate(mapCenter);
    try {
      if (!destination.trim()) {
        const places = await Location.reverseGeocodeAsync(mapCenter).catch(() => []);
        setDestination(placeLabel(places[0]) ?? "Pinned destination");
      }
    } finally { setPinning(false); }
  };

  const submit = async () => {
    if (!destinationCoordinate) return setError("Search for a destination or move the map and use the center flag.");
    if (!destination.trim()) return setError("Give your destination a recognizable name.");
    setSaving(true); setError(undefined);
    try {
      const journey = await api.createJourney({
        title: title.trim() || "My journey", originLabel: origin.trim() || null, destinationLabel: destination.trim(), destinationCoordinate,
        travelMode, agentInstructions: agentInstructions.trim() || null, companionUpdatesEnabled: companionUpdates, companionCallEnabled: companionUpdates && companionCalls,
        updateDelayThresholdMinutes: delayThreshold, expectedArrivalAt: new Date(Date.now() + duration * 60_000).toISOString(), checkInIntervalMinutes: checkIn,
        graceMinutes: grace, voiceCallEnabled: voice, notes: notes.trim() || null, contactIds: selected,
      });
      navigation.replace("JourneyDetail", { journeyId: journey.id });
    } catch (value) { setError((value as ApiError).message); }
    finally { setSaving(false); }
  };

  return (
    <Screen safeTop={false} style={styles.screen}>
      <View style={styles.heroCopy}>
        <Text style={styles.kicker}>New route</Text>
        <Text style={styles.title}>Where next?</Text>
        <Text style={styles.lede}>Choose a destination. Then tell your map what matters.</Text>
      </View>

      <View style={styles.mapShell}>
        <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={initialDestinationCoordinate ? { ...initialDestinationCoordinate, latitudeDelta: 0.045, longitudeDelta: 0.045 } : initialRegion} onRegionChangeComplete={(region) => { const coordinate = { latitude: region.latitude, longitude: region.longitude }; setMapCenter(coordinate); if (destinationCoordinate && (Math.abs(destinationCoordinate.latitude - coordinate.latitude) > 0.0005 || Math.abs(destinationCoordinate.longitude - coordinate.longitude) > 0.0005)) setDestinationCoordinate(undefined); }} showsCompass={false} showsPointsOfInterests pitchEnabled={false} />
        <View pointerEvents="none" style={styles.centerPin}><View style={styles.pinBubble}><Ionicons name="flag" size={20} color={colors.white} /></View><View style={styles.pinStem} /><View style={styles.pinDot} /></View>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={inkMuted} />
          <TextInput accessibilityLabel="Search destination" value={destination} onChangeText={(value) => { setDestination(value); if (destinationCoordinate) setDestinationCoordinate(undefined); }} onSubmitEditing={() => void searchDestination()} placeholder="City, hotel or landmark" placeholderTextColor={inkMuted} returnKeyType="search" autoCapitalize="words" style={styles.searchInput} />
          <Pressable accessibilityRole="button" accessibilityLabel="Search map" disabled={searching || destination.trim().length < 2} onPress={() => void searchDestination()} style={[styles.searchButton, (searching || destination.trim().length < 2) && styles.searchButtonDisabled]}>
            {searching ? <ActivityIndicator color={colors.white} size="small" /> : <Ionicons name="arrow-forward" size={20} color={colors.white} />}
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Center map on my location" onPress={() => void useCurrentLocation()} style={styles.locationButton}>{locating ? <ActivityIndicator color={colors.forest} size="small" /> : <Ionicons name="locate" size={21} color={colors.forest} />}</Pressable>
        <View pointerEvents="none" style={styles.mapCaption}><View style={styles.mapCaptionDot} /><Text style={styles.mapCaptionText}>Drag to refine the pin</Text></View>
      </View>

      <View style={styles.destinationStrip}>
        <View style={styles.routeGlyph}><View style={styles.routeDot} /><View style={styles.routeLine} /><Ionicons name="location" size={19} color={colors.coral} /></View>
        <View style={styles.destinationCopy}>
          <Text style={styles.destinationStatus}>{destinationCoordinate ? "Destination set" : "Choose your destination"}</Text>
          <Text numberOfLines={2} style={styles.destinationName}>{destinationCoordinate ? destination || "Pinned destination" : "Search above, or place the flag yourself"}</Text>
        </View>
        {destinationCoordinate && <Ionicons name="checkmark" size={22} color={colors.success} />}
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Use center flag as destination" onPress={() => void pinDestination()} style={({ pressed }) => [styles.manualPicker, pressed && styles.pressed]}>
        <Ionicons name="scan-outline" size={20} color={colors.lime} />
        <View style={styles.manualCopy}><Text style={styles.manualTitle}>Or choose on the map</Text><Text style={styles.manualSubtitle}>Move the flag, then set this point</Text></View>
        <Text style={styles.manualAction}>{pinning ? "Setting…" : "Set pin"}</Text>
      </Pressable>

      <View style={styles.form}>
        <SectionIntro title="Trip details" copy="Name the journey and tell us where it begins." />
        <View style={styles.lineFields}>
          <LineField label="Journey name" icon="bookmark-outline" value={title} onChangeText={setTitle} autoCapitalize="sentences" />
          <LineField label="Starting from" optional icon="radio-button-on-outline" value={origin} onChangeText={setOrigin} autoCapitalize="words" placeholder="Current location" />
        </View>

        <SectionIntro title="How are you going?" copy="This sets the live signals Turtle watches along the way." />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeRow}>{modes.map((mode) => <ModeChoice key={mode.value} {...mode} selected={travelMode === mode.value} onPress={() => setTravelMode(mode.value)} />)}</ScrollView>

        <View style={styles.agentComposer}>
          <View style={styles.agentComposerMeta}><View style={styles.agentSignal}><View style={styles.agentSignalCore} /></View><Text style={styles.agentComposerLabel}>Route brief</Text><Text style={styles.agentPrivate}>Private</Text></View>
          <Text style={styles.agentComposerTitle}>Tell the map what matters.</Text>
          <Text style={styles.agentComposerCopy}>Use your own words. Turtle encrypts the saved brief; in production, the configured AI provider maps it only into supported route preferences and never controls safety escalation.</Text>
          <TextInput accessibilityLabel="Journey preferences for route agent" value={agentInstructions} onChangeText={setAgentInstructions} multiline maxLength={1500} autoCapitalize="sentences" placeholder="I prefer scenic roads. Remind me to take a coffee break after 90 minutes, use well-lit stops after dark, and call me if my arrival shifts by more than 20 minutes." placeholderTextColor="#858891" style={styles.agentInput} />
          <View style={styles.agentComposerFooter}><Ionicons name="lock-closed-outline" size={15} color={colors.sage} /><Text style={styles.agentComposerHint}>Encrypted with this journey</Text><Text style={styles.agentCount}>{agentInstructions.length}/1500</Text></View>
        </View>

        <View style={styles.agentControls}>
          <View style={styles.agentControlsHeader}><Text style={styles.agentControlsTitle}>Stay ahead of changes</Text><Ionicons name="pulse" size={22} color={colors.lime} /></View>
          <Text style={styles.agentControlsCopy}>{__DEV__ ? "This development build uses a test route-update flow until Google Routes is configured. Safety escalation remains deterministic and under your control." : "Your route agent checks live timing while the journey is active. Safety escalation remains deterministic and under your control."}</Text>
          <Preference icon="notifications-outline" title="Journey updates" copy="Useful timing and route changes" value={companionUpdates} onChange={() => { setCompanionUpdates((value) => { if (value) setCompanionCalls(false); return !value; }); }} />
          {companionUpdates && <Preference icon="call-outline" title="Call me about meaningful delays" copy="A spoken update from your route agent" value={companionCalls} onChange={() => setCompanionCalls((value) => !value)} />}
          {companionUpdates && <ChoiceSection label="Tell me when a delay exceeds"><View style={styles.choices}>{[10, 15, 30].map((minutes) => <Choice key={minutes} label={`${minutes} min`} selected={delayThreshold === minutes} onPress={() => setDelayThreshold(minutes)} />)}</View></ChoiceSection>}
          {companionCalls && <View style={styles.callNotice}><Ionicons name="information-circle-outline" size={18} color={colors.forest} /><Text style={styles.callNoticeText}>Calls only go to your profile number, at most once every 45 minutes. They never contact emergency services.</Text></View>}
        </View>

        <View style={styles.timingSection}>
          <SectionIntro title="Timing & check-ins" copy="Set a pace that feels reassuring, not intrusive." />
          <ChoiceSection label="Expected travel time"><View style={styles.choices}>{durations.map((item) => <Choice key={item.minutes} label={item.label} selected={duration === item.minutes} onPress={() => setDuration(item.minutes)} />)}</View></ChoiceSection>
          <ChoiceSection label="Safety check-in rhythm"><View style={styles.choices}>{checkIns.map((minutes) => <Choice key={minutes} label={minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`} selected={checkIn === minutes} onPress={() => setCheckIn(minutes)} />)}</View></ChoiceSection>
          <ChoiceSection label="Grace period before contacts are notified"><View style={styles.choices}>{[10, 15, 30, 60].map((minutes) => <Choice key={minutes} label={`${minutes} min`} selected={grace === minutes} onPress={() => setGrace(minutes)} />)}</View></ChoiceSection>
          <Preference icon="call-outline" title="Wellness call after a missed check-in" copy="Turtle calls before approved contacts are notified" value={voice} onChange={() => setVoice((value) => !value)} />
        </View>

        <View style={styles.safetySection}>
          <SectionIntro title="Who should expect you?" copy="Optional. Choose people Turtle may notify only after your grace period." />
          {contacts.length === 0 ? <View style={styles.noContacts}><Text style={styles.emptyCopy}>You can build the route now and add a trusted contact whenever you want safety sharing.</Text><Pressable accessibilityRole="button" onPress={() => navigation.navigate("AddContact")} style={styles.addContact}><Ionicons name="person-add-outline" size={18} color={colors.forest} /><Text style={styles.addContactText}>Add a contact</Text></Pressable></View> : <View style={styles.contactList}>{contacts.map((contact) => <Pressable key={contact.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(contact.id) }} onPress={() => setSelected((current) => current.includes(contact.id) ? current.filter((id) => id !== contact.id) : [...current, contact.id])} style={({ pressed }) => [styles.contact, pressed && styles.pressed]}><View style={[styles.contactAvatar, selected.includes(contact.id) && styles.contactAvatarSelected]}><Text style={[styles.contactInitial, selected.includes(contact.id) && styles.contactInitialSelected]}>{contact.name.slice(0, 1)}</Text></View><View style={{ flex: 1 }}><Text style={styles.contactName}>{contact.name}</Text><Text style={styles.contactRelation}>{contact.relationship}</Text></View><Ionicons name={selected.includes(contact.id) ? "checkmark-circle" : "ellipse-outline"} size={25} color={selected.includes(contact.id) ? colors.forest : "#A7B0AA"} /></Pressable>)}</View>}
        </View>

        <LineField label="Private trip note" optional icon="document-text-outline" value={notes} onChangeText={setNotes} autoCapitalize="sentences" multiline maxLength={1000} placeholder="Hotel, trail or vehicle details…" style={styles.notes} />
        {error && <View style={styles.errorBox}><Ionicons name="alert-circle-outline" size={19} color={colors.danger} /><Text style={styles.error}>{error}</Text></View>}
        <Pressable accessibilityRole="button" accessibilityLabel="Build my route" disabled={saving} onPress={() => void submit()} style={({ pressed }) => [styles.reviewButton, pressed && styles.reviewButtonPressed, saving && styles.reviewButtonDisabled]}>
          <Text style={styles.reviewButtonText}>Build my route</Text>
          <View style={styles.reviewArrow}>{saving ? <ActivityIndicator color={colors.accent} size="small" /> : <Ionicons name="arrow-forward" size={20} color={colors.accent} />}</View>
        </Pressable>
        <Text style={styles.footerNote}>Nothing is shared until your journey starts.</Text>
      </View>
    </Screen>
  );
}

function SectionIntro({ title, copy }: { title: string; copy: string }) { return <View style={styles.sectionIntro}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionCopy}>{copy}</Text></View>; }
function ChoiceSection({ label, children }: React.PropsWithChildren<{ label: string }>) { return <View style={styles.choiceSection}><Text style={styles.choiceLabel}>{label}</Text>{children}</View>; }
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.pressed]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>; }
function ModeChoice({ label, icon, selected, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.mode, selected && styles.modeSelected, pressed && styles.pressed]}><Ionicons name={icon} size={24} color={selected ? colors.lime : colors.forest} /><Text style={[styles.modeLabel, selected && styles.modeLabelSelected]}>{label}</Text>{selected && <View style={styles.modeIndicator} />}</Pressable>; }
function Preference({ icon, title, copy, value, onChange }: { icon: keyof typeof Ionicons.glyphMap; title: string; copy: string; value: boolean; onChange: () => void }) { return <View style={styles.preference}><View style={styles.preferenceIcon}><Ionicons name={icon} size={20} color={colors.ink} /></View><View style={{ flex: 1 }}><Text style={styles.preferenceTitle}>{title}</Text><Text style={styles.preferenceCopy}>{copy}</Text></View><Switch accessibilityLabel={title} value={value} onValueChange={onChange} trackColor={{ false: "#D8D9DE", true: colors.lime }} thumbColor={colors.white} /></View>; }
function LineField({ label, optional, icon, style, ...props }: TextInputProps & { label: string; optional?: boolean; icon: keyof typeof Ionicons.glyphMap }) { return <View style={styles.lineField}><View style={styles.lineFieldLabelRow}><Text style={styles.lineFieldLabel}>{label}</Text>{optional && <Text style={styles.optional}>Optional</Text>}</View><View style={styles.lineFieldInputRow}><Ionicons name={icon} size={20} color={inkMuted} /><TextInput {...props} placeholderTextColor="#8B8D94" style={[styles.lineFieldInput, props.multiline && styles.lineFieldMultiline, style]} /></View></View>; }

const inkMuted = "#696B72";

const styles = StyleSheet.create({
  screen: { paddingTop: 14, paddingBottom: 58 },
  heroCopy: { maxWidth: 345, marginBottom: 24 },
  kicker: { color: colors.accent, fontSize: 14, lineHeight: 19, fontWeight: "800", marginBottom: 7 },
  title: { color: colors.ink, fontSize: 48, lineHeight: 50, letterSpacing: -2, fontWeight: "700", fontFamily: Platform.OS === "ios" ? "Avenir Next" : undefined },
  lede: { color: inkMuted, fontSize: 17, lineHeight: 24, marginTop: 9, maxWidth: 330 },
  mapShell: { height: 410, marginHorizontal: -22, overflow: "hidden", backgroundColor: colors.sky },
  centerPin: { position: "absolute", left: "50%", top: "50%", marginLeft: -19, marginTop: -55, alignItems: "center" },
  pinBubble: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.coral, borderWidth: 3, borderColor: colors.white, alignItems: "center", justifyContent: "center", shadowColor: colors.forestDeep, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.2, shadowRadius: 8 },
  pinStem: { width: 3, height: 18, backgroundColor: colors.coral },
  pinDot: { width: 9, height: 4, borderRadius: 2, backgroundColor: "rgba(17,18,22,0.25)" },
  searchBar: { position: "absolute", top: 16, left: 22, right: 22, minHeight: 62, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.98)", paddingLeft: 16, paddingRight: 7, flexDirection: "row", alignItems: "center", gap: 10, shadowColor: colors.forestDeep, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 18 },
  searchInput: { flex: 1, minHeight: 54, color: colors.ink, fontSize: 16, fontWeight: "600" },
  searchButton: { width: 48, height: 48, borderRadius: 9, backgroundColor: colors.forestDeep, alignItems: "center", justifyContent: "center" },
  searchButtonDisabled: { backgroundColor: "#A7A79F", opacity: 1 },
  locationButton: { position: "absolute", top: 90, right: 22, width: 46, height: 46, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.98)", alignItems: "center", justifyContent: "center", shadowColor: colors.forestDeep, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.12, shadowRadius: 12 },
  mapCaption: { position: "absolute", bottom: 14, alignSelf: "center", borderRadius: 8, backgroundColor: "rgba(12,12,14,0.82)", paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 7 },
  mapCaptionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.coral },
  mapCaptionText: { color: colors.white, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  destinationStrip: { minHeight: 88, flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  routeGlyph: { width: 28, height: 50, alignItems: "center", justifyContent: "space-between" },
  routeDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: colors.forest },
  routeLine: { flex: 1, width: 1, marginVertical: 3, backgroundColor: "#9B9DA4" },
  destinationCopy: { flex: 1, paddingVertical: 14 },
  destinationStatus: { color: inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  destinationName: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "700", marginTop: 3 },
  manualPicker: { minHeight: 64, flexDirection: "row", gap: 12, alignItems: "center", paddingHorizontal: 2 },
  manualCopy: { flex: 1 },
  manualTitle: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  manualSubtitle: { color: inkMuted, fontSize: 12, lineHeight: 17, marginTop: 1 },
  manualAction: { color: colors.accent, fontSize: 14, fontWeight: "800" },
  form: { marginTop: 44, gap: 36 },
  sectionIntro: { gap: 6 },
  sectionTitle: { color: colors.ink, fontSize: 25, lineHeight: 30, fontWeight: "700", letterSpacing: -0.6, fontFamily: Platform.OS === "ios" ? "Avenir Next" : undefined },
  sectionCopy: { color: inkMuted, fontSize: 14, lineHeight: 20, maxWidth: 320 },
  lineFields: { borderTopWidth: 1, borderTopColor: colors.ink },
  lineField: { paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#C9CBD0" },
  lineFieldLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  lineFieldLabel: { color: inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  optional: { color: "#919995", fontSize: 11, lineHeight: 15 },
  lineFieldInputRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  lineFieldInput: { flex: 1, minHeight: 34, paddingVertical: 2, color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: "600" },
  lineFieldMultiline: { minHeight: 82, textAlignVertical: "top", paddingTop: 2 },
  notes: { minHeight: 82 },
  modeRow: { gap: 2, paddingRight: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  mode: { position: "relative", width: 76, minHeight: 78, paddingHorizontal: 6, paddingVertical: 12, backgroundColor: "transparent", alignItems: "center", justifyContent: "center", gap: 7 },
  modeSelected: { backgroundColor: colors.accentSoft },
  modeIndicator: { position: "absolute", left: 12, right: 12, bottom: 0, height: 3, backgroundColor: colors.accent },
  modeLabel: { color: colors.forest, fontSize: 12, lineHeight: 16, fontWeight: "600", textAlign: "center" },
  modeLabelSelected: { color: colors.accent, fontWeight: "800" },
  agentComposer: { backgroundColor: colors.forestDeep, borderRadius: 16, padding: 20, gap: 12, shadowColor: colors.forestDeep, shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.16, shadowRadius: 24, elevation: 4 },
  agentComposerMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  agentSignal: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: colors.sage, alignItems: "center", justifyContent: "center" },
  agentSignalCore: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.coral },
  agentComposerLabel: { color: colors.sageSoft, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  agentPrivate: { marginLeft: "auto", color: "#969A90", fontSize: 11, lineHeight: 15 },
  agentComposerTitle: { color: colors.white, fontSize: 27, lineHeight: 31, letterSpacing: -0.7, fontWeight: "700", fontFamily: Platform.OS === "ios" ? "Avenir Next" : undefined },
  agentComposerCopy: { color: "#BFC2B7", fontSize: 14, lineHeight: 20 },
  agentInput: { minHeight: 152, borderWidth: 1, borderColor: "#383A33", borderRadius: 11, backgroundColor: "#191A17", color: colors.white, fontSize: 16, lineHeight: 23, padding: 15, textAlignVertical: "top" },
  agentComposerFooter: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 6 },
  agentComposerHint: { color: "#AEB2A7", fontSize: 11, lineHeight: 15 },
  agentCount: { marginLeft: "auto", color: "#7C8076", fontSize: 11, fontVariant: ["tabular-nums"] },
  agentControls: { gap: 0, borderTopWidth: 1, borderTopColor: colors.ink, paddingTop: 18 },
  agentControlsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  agentControlsTitle: { color: colors.ink, fontSize: 22, lineHeight: 27, fontWeight: "700", letterSpacing: -0.35 },
  agentControlsCopy: { color: inkMuted, fontSize: 14, lineHeight: 20, marginTop: 7, marginBottom: 8 },
  preference: { minHeight: 74, flexDirection: "row", gap: 12, alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#C9CBD0", paddingVertical: 12 },
  preferenceIcon: { width: 28, alignItems: "flex-start", justifyContent: "center" },
  preferenceTitle: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  preferenceCopy: { color: inkMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  callNotice: { flexDirection: "row", gap: 9, backgroundColor: colors.sageSoft, borderRadius: 10, padding: 12, marginTop: 12 },
  callNoticeText: { color: "#555B50", fontSize: 12, lineHeight: 17, flex: 1 },
  timingSection: { gap: 22 },
  choiceSection: { gap: 10 },
  choiceLabel: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { minHeight: 46, minWidth: 68, paddingHorizontal: 15, borderRadius: 10, backgroundColor: "transparent", borderWidth: 1, borderColor: "#C9CBD0", alignItems: "center", justifyContent: "center" },
  choiceSelected: { backgroundColor: colors.forestDeep, borderColor: colors.forestDeep },
  choiceText: { fontSize: 13, fontWeight: "700", color: colors.forest },
  choiceTextSelected: { color: colors.white },
  safetySection: { gap: 12 },
  contactList: { borderTopWidth: 1, borderTopColor: colors.ink },
  contact: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#C9CBD0", paddingVertical: 11 },
  contactAvatar: { width: 42, height: 42, borderRadius: 11, backgroundColor: "#E7E8EC", alignItems: "center", justifyContent: "center" },
  contactAvatarSelected: { backgroundColor: colors.peach },
  contactInitial: { fontWeight: "800", color: inkMuted, fontSize: 16 },
  contactInitialSelected: { color: colors.forest },
  contactName: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  contactRelation: { color: inkMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  noContacts: { minHeight: 110, justifyContent: "center", gap: 12, borderTopWidth: 1, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.ink, paddingVertical: 18 },
  emptyCopy: { color: inkMuted, fontSize: 14, lineHeight: 20 },
  addContact: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" },
  addContactText: { color: colors.forest, fontSize: 14, fontWeight: "800" },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: 9, backgroundColor: "#FFF0EB", padding: 13, borderRadius: 10 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18, fontWeight: "600", flex: 1 },
  reviewButton: { minHeight: 64, borderRadius: 14, backgroundColor: colors.forestDeep, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 22, paddingRight: 8 },
  reviewButtonPressed: { transform: [{ scale: 0.985 }], opacity: 0.94 },
  reviewButtonDisabled: { opacity: 0.42 },
  reviewButtonText: { color: colors.white, fontSize: 17, lineHeight: 22, fontWeight: "800" },
  reviewArrow: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  footerNote: { color: inkMuted, fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: -20 },
  pressed: { opacity: 0.68 },
});
