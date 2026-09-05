import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useRef, useState } from "react";
import {
  Animated,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";

type DemoStage = "brief" | "planned" | "authorized" | "rerouted" | "checkedIn";
type Coordinate = { latitude: number; longitude: number };

const COLORS = {
  ink: "#171914",
  paper: "#F4F0E6",
  white: "#FFFDF7",
  olive: "#68705A",
  line: "#D4CEBE",
  orange: "#E85D2A",
  amber: "#D99A2B",
  red: "#C83E32",
  green: "#277455",
  blue: "#376D88",
  muted: "#6F7068",
};

const REGION = {
  latitude: 28.145,
  longitude: 85.323,
  latitudeDelta: 0.105,
  longitudeDelta: 0.09,
};

const hub: Coordinate = { latitude: 28.1087, longitude: 85.2967 };
const camp: Coordinate = { latitude: 28.1845, longitude: 85.361 };
const washedBridge: Coordinate = { latitude: 28.1415, longitude: 85.327 };
const unstableSlope: Coordinate = { latitude: 28.163, longitude: 85.344 };
const newClosure: Coordinate = { latitude: 28.149, longitude: 85.313 };

const riverRoute: Coordinate[] = [
  hub,
  { latitude: 28.121, longitude: 85.306 },
  { latitude: 28.132, longitude: 85.317 },
  washedBridge,
  { latitude: 28.157, longitude: 85.341 },
  camp,
];

const ridgeRoute: Coordinate[] = [
  hub,
  { latitude: 28.119, longitude: 85.286 },
  { latitude: 28.136, longitude: 85.296 },
  { latitude: 28.153, longitude: 85.309 },
  { latitude: 28.172, longitude: 85.333 },
  camp,
];

const fallbackRoute: Coordinate[] = [
  hub,
  { latitude: 28.116, longitude: 85.279 },
  { latitude: 28.142, longitude: 85.27 },
  { latitude: 28.17, longitude: 85.292 },
  { latitude: 28.191, longitude: 85.326 },
  camp,
];

const SOURCE_URLS = {
  iom: "https://asiapacific.iom.int/sites/g/files/tmzbdl671/files/documents/2026-09/iom-nepal-flood-sitrep-2.pdf",
  redCross: "https://website-api.nrcs.org/media/highlights/files/Rasuwa_Situation_Update_5.pdf",
};

function MarkerBadge({
  color,
  icon,
  label,
}: {
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.markerWrap}>
      <View style={[styles.marker, { backgroundColor: color }]}>
        <Ionicons name={icon} size={16} color={COLORS.white} />
      </View>
      <View style={styles.markerLabel}>
        <Text style={styles.markerLabelText}>{label}</Text>
      </View>
    </View>
  );
}

function StatusChip({ tone, children }: { tone: "good" | "warn" | "bad" | "info"; children: React.ReactNode }) {
  const color = tone === "good" ? COLORS.green : tone === "warn" ? COLORS.amber : tone === "bad" ? COLORS.red : COLORS.blue;
  return (
    <View style={[styles.statusChip, { borderColor: color }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusChipText, { color }]}>{children}</Text>
    </View>
  );
}

function SourceRow({
  icon,
  title,
  detail,
  status,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  status: string;
  onPress?: () => void;
}) {
  const content = (
    <>
      <View style={styles.sourceIcon}>
        <Ionicons name={icon} size={17} color={COLORS.ink} />
      </View>
      <View style={styles.sourceCopy}>
        <Text style={styles.sourceTitle}>{title}</Text>
        <Text style={styles.sourceDetail}>{detail}</Text>
      </View>
      <Text style={styles.sourceStatus}>{status}</Text>
      {onPress ? <Ionicons name="open-outline" size={15} color={COLORS.muted} /> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable accessibilityRole="link" onPress={onPress} style={({ pressed }) => [styles.sourceRow, pressed && styles.pressed]}>
        {content}
      </Pressable>
    );
  }
  return <View style={styles.sourceRow}>{content}</View>;
}

function ActionButton({
  label,
  icon,
  onPress,
  variant = "primary",
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  variant?: "primary" | "danger" | "success";
}) {
  const backgroundColor = variant === "danger" ? COLORS.red : variant === "success" ? COLORS.green : COLORS.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, { backgroundColor }, pressed && styles.actionButtonPressed]}
    >
      <Text style={styles.actionButtonText}>{label}</Text>
      <View style={styles.actionButtonIcon}>
        <Ionicons name={icon} size={19} color={backgroundColor} />
      </View>
    </Pressable>
  );
}

export function BurningMapsDemo() {
  const [stage, setStage] = useState<DemoStage>("brief");
  const reveal = useRef(new Animated.Value(1)).current;
  const isPlanned = stage !== "brief";
  const isAuthorized = stage === "authorized" || stage === "rerouted" || stage === "checkedIn";
  const isRerouted = stage === "rerouted" || stage === "checkedIn";

  const transition = (next: DemoStage) => {
    Animated.sequence([
      Animated.timing(reveal, { toValue: 0.25, duration: 100, useNativeDriver: true }),
      Animated.timing(reveal, { toValue: 1, duration: 320, useNativeDriver: true }),
    ]).start();
    setStage(next);
  };

  const operationLabel = useMemo(() => {
    if (stage === "brief") return "AWAITING ANALYSIS";
    if (stage === "planned") return "ROUTE READY · APPROVAL REQUIRED";
    if (stage === "authorized") return "TEAM K–2 EN ROUTE";
    if (stage === "rerouted") return "MISSION REPLANNED";
    return "TEAM K–2 SAFE · 14:47";
  }, [stage]);

  const activeRoute = isRerouted ? fallbackRoute : ridgeRoute;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.masthead}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Ionicons name="navigate" size={18} color={COLORS.ink} />
            </View>
            <View>
              <Text style={styles.brand}>BURNING MAPS</Text>
              <Text style={styles.brandSub}>HUMANITARIAN ACCESS DESK</Text>
            </View>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>DEMO</Text>
            </View>
          </View>

          <Text style={styles.hero}>When the road{`\n`}is no longer there.</Text>
          <Text style={styles.heroSub}>
            Evidence-aware mission planning for teams moving through rapidly changing terrain.
          </Text>

          <View style={styles.operationBar}>
            <Text style={styles.operationCode}>NPL–RSW–026</Text>
            <Text style={styles.operationStatus}>{operationLabel}</Text>
          </View>
        </View>

        <View style={styles.mapFrame}>
          <MapView initialRegion={REGION} style={styles.map} mapType="mutedStandard" rotateEnabled={false}>
            {isPlanned ? (
              <>
                <Polyline coordinates={riverRoute} strokeColor={COLORS.red} strokeWidth={4} lineDashPattern={[7, 5]} />
                <Polyline
                  coordinates={activeRoute}
                  strokeColor={isAuthorized ? COLORS.green : COLORS.ink}
                  strokeWidth={5}
                />
                {!isRerouted ? (
                  <Polyline coordinates={fallbackRoute} strokeColor={COLORS.amber} strokeWidth={3} lineDashPattern={[4, 5]} />
                ) : null}
              </>
            ) : null}
            <Marker coordinate={hub} anchor={{ x: 0.5, y: 1 }}>
              <MarkerBadge color={COLORS.ink} icon="cube-outline" label="Dhunche hub" />
            </Marker>
            <Marker coordinate={camp} anchor={{ x: 0.5, y: 1 }}>
              <MarkerBadge color={COLORS.green} icon="medical-outline" label="Relief camp A" />
            </Marker>
            <Marker coordinate={washedBridge} anchor={{ x: 0.5, y: 1 }}>
              <MarkerBadge color={COLORS.red} icon="close" label="Bridge out" />
            </Marker>
            <Marker coordinate={unstableSlope} anchor={{ x: 0.5, y: 1 }}>
              <MarkerBadge color={COLORS.amber} icon="warning-outline" label="Slope watch" />
            </Marker>
            {isRerouted ? (
              <Marker coordinate={newClosure} anchor={{ x: 0.5, y: 1 }}>
                <MarkerBadge color={COLORS.red} icon="alert" label="New closure" />
              </Marker>
            ) : null}
          </MapView>

          <View style={styles.mapLegend}>
            <View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: COLORS.green }]} /><Text style={styles.legendText}>Active</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: COLORS.amber }]} /><Text style={styles.legendText}>Uncertain</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: COLORS.red }]} /><Text style={styles.legendText}>Blocked</Text></View>
          </View>
          <View style={styles.simulationFlag}>
            <Text style={styles.simulationText}>TRAINING SIMULATION · NOT FOR NAVIGATION</Text>
          </View>
        </View>

        <Animated.View style={{ opacity: reveal }}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIndex}>01</Text>
            <Text style={styles.sectionTitle}>MISSION BRIEF</Text>
          </View>
          <View style={styles.missionCard}>
            <View style={styles.missionTop}>
              <StatusChip tone="bad">HIGH PRIORITY</StatusChip>
              <Text style={styles.missionTime}>BEFORE 17:30</Text>
            </View>
            <Text style={styles.missionTitle}>Medical resupply to Relief Camp A</Text>
            <Text style={styles.missionBody}>
              Move 24 trauma kits and water-purification tablets from Dhunche logistics hub. Avoid reported bridge damage and slopes without a field update in the last two hours.
            </Text>
            <View style={styles.payloadRow}>
              <View style={styles.payloadItem}><Ionicons name="cube-outline" size={17} color={COLORS.ink} /><Text style={styles.payloadText}>186 kg</Text></View>
              <View style={styles.payloadItem}><Ionicons name="people-outline" size={17} color={COLORS.ink} /><Text style={styles.payloadText}>Team K–2</Text></View>
              <View style={styles.payloadItem}><Ionicons name="car-outline" size={17} color={COLORS.ink} /><Text style={styles.payloadText}>4×4</Text></View>
            </View>
          </View>

          {!isPlanned ? (
            <View style={styles.actionSection}>
              <ActionButton label="Analyze access evidence" icon="arrow-forward" onPress={() => transition("planned")} />
              <Text style={styles.actionHint}>Burning Maps will compare route candidates against timestamped access reports.</Text>
            </View>
          ) : (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionIndex}>02</Text>
                <Text style={styles.sectionTitle}>{isRerouted ? "REPLANNED ACCESS" : "ROUTE DECISION"}</Text>
              </View>

              <View style={[styles.routeCard, styles.routeCardSelected]}>
                <View style={styles.routeHead}>
                  <View style={[styles.routeNumber, { backgroundColor: isRerouted ? COLORS.amber : COLORS.green }]}>
                    <Text style={styles.routeNumberText}>{isRerouted ? "C" : "B"}</Text>
                  </View>
                  <View style={styles.routeTitleWrap}>
                    <Text style={styles.routeTitle}>{isRerouted ? "Western fallback" : "Ridge relay"}</Text>
                    <Text style={styles.routeMeta}>{isRerouted ? "42 km · 2 hr 08 min" : "31 km · 1 hr 42 min"}</Text>
                  </View>
                  <StatusChip tone={isRerouted ? "warn" : "good"}>{isRerouted ? "CONDITIONAL" : "RECOMMENDED"}</StatusChip>
                </View>
                <View style={styles.decisionReason}>
                  <Ionicons name={isRerouted ? "git-branch-outline" : "shield-checkmark-outline"} size={19} color={COLORS.ink} />
                  <Text style={styles.decisionText}>
                    {isRerouted
                      ? "Selected after Team R–4 reported a new washout. Adds 11 km; no known blocked crossings."
                      : "Latest passability check is 18 minutes old. Avoids the washed river crossing and carries the required vehicle class."}
                  </Text>
                </View>
                <View style={styles.confidenceRow}>
                  <Text style={styles.confidenceLabel}>EVIDENCE CONFIDENCE</Text>
                  <View style={styles.confidenceTrack}>
                    <View style={[styles.confidenceFill, { width: isRerouted ? "68%" : "86%", backgroundColor: isRerouted ? COLORS.amber : COLORS.green }]} />
                  </View>
                  <Text style={styles.confidenceValue}>{isRerouted ? "68%" : "86%"}</Text>
                </View>
              </View>

              <View style={[styles.routeCard, styles.routeCardRejected]}>
                <View style={styles.routeHead}>
                  <View style={[styles.routeNumber, { backgroundColor: COLORS.red }]}><Text style={styles.routeNumberText}>A</Text></View>
                  <View style={styles.routeTitleWrap}>
                    <Text style={styles.routeTitle}>River corridor</Text>
                    <Text style={styles.routeMeta}>24 km · 1 hr 10 min</Text>
                  </View>
                  <StatusChip tone="bad">REJECTED</StatusChip>
                </View>
                <Text style={styles.rejectedReason}>Intersects a bridge marked impassable in two independent updates.</Text>
              </View>

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionIndex}>03</Text>
                <Text style={styles.sectionTitle}>EVIDENCE LEDGER</Text>
              </View>
              <View style={styles.sourcesCard}>
                <SourceRow
                  icon="document-text-outline"
                  title="IOM Nepal Flood SitRep"
                  detail="Access constraints · public report"
                  status="OFFICIAL"
                  onPress={() => void Linking.openURL(SOURCE_URLS.iom)}
                />
                <SourceRow
                  icon="medical-outline"
                  title="Nepal Red Cross update"
                  detail="Roads, bridges and relief access"
                  status="OFFICIAL"
                  onPress={() => void Linking.openURL(SOURCE_URLS.redCross)}
                />
                <SourceRow
                  icon="radio-outline"
                  title={isRerouted ? "Team R–4 · field radio" : "Team K–1 · field check"}
                  detail={isRerouted ? "Washout at km 12 · 3 min ago" : "Ridge relay passable · 18 min ago"}
                  status={isRerouted ? "NEW" : "VERIFIED"}
                />
              </View>

              <View style={styles.actionSection}>
                {stage === "planned" ? (
                  <>
                    <ActionButton label="Human approve & dispatch" icon="checkmark" onPress={() => transition("authorized")} variant="success" />
                    <Text style={styles.actionHint}>The recommendation cannot dispatch a team without coordinator approval.</Text>
                  </>
                ) : null}
                {stage === "authorized" ? (
                  <>
                    <ActionButton label="Simulate new road closure" icon="warning-outline" onPress={() => transition("rerouted")} variant="danger" />
                    <Text style={styles.actionHint}>Demonstrates failure recovery when field evidence invalidates an active route.</Text>
                  </>
                ) : null}
                {stage === "rerouted" ? (
                  <>
                    <ActionButton label="Confirm responder check-in" icon="radio-outline" onPress={() => transition("checkedIn")} variant="success" />
                    <Text style={styles.actionHint}>Fallback route remains conditional until the field team confirms progress.</Text>
                  </>
                ) : null}
                {stage === "checkedIn" ? (
                  <View style={styles.successPanel}>
                    <View style={styles.successIcon}><Ionicons name="checkmark" size={24} color={COLORS.white} /></View>
                    <View style={styles.successCopy}>
                      <Text style={styles.successTitle}>Team K–2 checked in safely</Text>
                      <Text style={styles.successBody}>Position received · fallback route active · next check-in in 20 min</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel="Restart demo" onPress={() => transition("brief")}>
                      <Ionicons name="refresh" size={22} color={COLORS.ink} />
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </>
          )}
        </Animated.View>

        <View style={styles.disclaimer}>
          <Ionicons name="information-circle-outline" size={18} color={COLORS.muted} />
          <Text style={styles.disclaimerText}>
            Prototype decision support. Routes, teams and field events shown here are simulated for the hackathon and must not be used for live rescue or navigation.
          </Text>
        </View>
        <Text style={styles.footer}>BUILT IN SAN FRANCISCO · SEPTEMBER 5, 2026</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.ink },
  screen: { flex: 1, backgroundColor: COLORS.paper },
  content: { paddingBottom: 42 },
  masthead: { backgroundColor: COLORS.ink, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },
  brandRow: { flexDirection: "row", alignItems: "center" },
  brandMark: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.orange, alignItems: "center", justifyContent: "center", marginRight: 10 },
  brand: { color: COLORS.white, fontSize: 16, lineHeight: 18, fontWeight: "900", letterSpacing: 1.5, fontFamily: "Avenir Next" },
  brandSub: { color: "#ABAFA2", fontSize: 8, lineHeight: 12, fontWeight: "800", letterSpacing: 1.4, fontFamily: "Avenir Next" },
  livePill: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#484B42", borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.orange },
  liveText: { color: COLORS.white, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  hero: { marginTop: 31, color: COLORS.white, fontSize: 42, lineHeight: 43, letterSpacing: -1.8, fontWeight: "700", fontFamily: "Georgia" },
  heroSub: { marginTop: 12, color: "#C7C9C1", fontSize: 14, lineHeight: 20, maxWidth: 330, fontFamily: "Avenir Next" },
  operationBar: { marginTop: 24, paddingTop: 13, borderTopWidth: 1, borderTopColor: "#3B3D37", flexDirection: "row", alignItems: "center" },
  operationCode: { color: COLORS.orange, fontSize: 10, fontWeight: "900", letterSpacing: 1.3 },
  operationStatus: { color: COLORS.white, marginLeft: "auto", fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  mapFrame: { margin: 12, backgroundColor: COLORS.white, borderRadius: 3, borderWidth: 1, borderColor: COLORS.line, overflow: "hidden" },
  map: { width: "100%", height: 282 },
  mapLegend: { position: "absolute", top: 10, left: 10, flexDirection: "row", gap: 10, backgroundColor: "rgba(255,253,247,0.95)", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 3 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendLine: { width: 14, height: 3 },
  legendText: { color: COLORS.ink, fontSize: 9, fontWeight: "800" },
  simulationFlag: { position: "absolute", bottom: 8, left: 8, backgroundColor: COLORS.ink, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 2 },
  simulationText: { color: COLORS.white, fontSize: 8, fontWeight: "900", letterSpacing: 0.7 },
  markerWrap: { alignItems: "center" },
  marker: { width: 31, height: 31, borderRadius: 16, borderWidth: 3, borderColor: COLORS.white, alignItems: "center", justifyContent: "center", shadowColor: COLORS.ink, shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  markerLabel: { backgroundColor: COLORS.ink, borderRadius: 2, marginTop: 3, paddingHorizontal: 5, paddingVertical: 2 },
  markerLabelText: { color: COLORS.white, fontSize: 7, fontWeight: "800" },
  sectionHeader: { marginTop: 20, marginHorizontal: 20, marginBottom: 9, flexDirection: "row", alignItems: "center", gap: 9 },
  sectionIndex: { color: COLORS.orange, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  sectionTitle: { color: COLORS.ink, fontSize: 11, fontWeight: "900", letterSpacing: 1.6 },
  missionCard: { marginHorizontal: 12, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, padding: 17 },
  missionTop: { flexDirection: "row", alignItems: "center" },
  missionTime: { marginLeft: "auto", color: COLORS.muted, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  missionTitle: { marginTop: 14, color: COLORS.ink, fontSize: 25, lineHeight: 29, fontWeight: "700", letterSpacing: -0.5, fontFamily: "Georgia" },
  missionBody: { marginTop: 10, color: "#46483F", fontSize: 14, lineHeight: 20, fontFamily: "Avenir Next" },
  payloadRow: { marginTop: 15, paddingTop: 13, borderTopWidth: 1, borderTopColor: COLORS.line, flexDirection: "row", gap: 18 },
  payloadItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  payloadText: { color: COLORS.ink, fontSize: 11, fontWeight: "800" },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 5 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusChipText: { fontSize: 8, fontWeight: "900", letterSpacing: 0.7 },
  actionSection: { marginHorizontal: 12, marginTop: 14 },
  actionButton: { minHeight: 58, paddingLeft: 18, paddingRight: 10, flexDirection: "row", alignItems: "center", borderRadius: 2 },
  actionButtonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  actionButtonText: { color: COLORS.white, fontSize: 14, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  actionButtonIcon: { marginLeft: "auto", width: 38, height: 38, backgroundColor: COLORS.white, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  actionHint: { marginTop: 8, marginHorizontal: 4, color: COLORS.muted, fontSize: 10, lineHeight: 14 },
  routeCard: { marginHorizontal: 12, marginBottom: 8, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, padding: 14 },
  routeCardSelected: { borderLeftWidth: 4, borderLeftColor: COLORS.green },
  routeCardRejected: { opacity: 0.7, borderLeftWidth: 4, borderLeftColor: COLORS.red },
  routeHead: { flexDirection: "row", alignItems: "center" },
  routeNumber: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 2, marginRight: 9 },
  routeNumberText: { color: COLORS.white, fontSize: 13, fontWeight: "900" },
  routeTitleWrap: { flex: 1 },
  routeTitle: { color: COLORS.ink, fontSize: 15, fontWeight: "900" },
  routeMeta: { marginTop: 2, color: COLORS.muted, fontSize: 10, fontWeight: "600" },
  decisionReason: { marginTop: 13, backgroundColor: "#ECE9DE", padding: 11, flexDirection: "row", gap: 9, alignItems: "flex-start" },
  decisionText: { flex: 1, color: COLORS.ink, fontSize: 11, lineHeight: 16 },
  confidenceRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  confidenceLabel: { color: COLORS.muted, fontSize: 8, fontWeight: "900", letterSpacing: 0.6 },
  confidenceTrack: { flex: 1, height: 5, backgroundColor: COLORS.line, overflow: "hidden" },
  confidenceFill: { height: "100%" },
  confidenceValue: { color: COLORS.ink, fontSize: 9, fontWeight: "900" },
  rejectedReason: { marginTop: 10, color: COLORS.red, fontSize: 10, lineHeight: 14 },
  sourcesCard: { marginHorizontal: 12, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line },
  sourceRow: { minHeight: 57, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line },
  sourceIcon: { width: 31, height: 31, borderRadius: 16, backgroundColor: "#E8E3D7", alignItems: "center", justifyContent: "center", marginRight: 9 },
  sourceCopy: { flex: 1 },
  sourceTitle: { color: COLORS.ink, fontSize: 11, fontWeight: "900" },
  sourceDetail: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  sourceStatus: { color: COLORS.green, fontSize: 8, fontWeight: "900", letterSpacing: 0.5, marginRight: 7 },
  pressed: { opacity: 0.65 },
  successPanel: { minHeight: 78, backgroundColor: "#DCE9DF", borderWidth: 1, borderColor: "#B8D0BF", padding: 13, flexDirection: "row", alignItems: "center" },
  successIcon: { width: 41, height: 41, borderRadius: 21, backgroundColor: COLORS.green, alignItems: "center", justifyContent: "center", marginRight: 11 },
  successCopy: { flex: 1 },
  successTitle: { color: COLORS.ink, fontSize: 13, fontWeight: "900" },
  successBody: { color: "#526258", fontSize: 9, lineHeight: 13, marginTop: 4 },
  disclaimer: { marginHorizontal: 20, marginTop: 29, paddingTop: 15, borderTopWidth: 1, borderTopColor: COLORS.line, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  disclaimerText: { flex: 1, color: COLORS.muted, fontSize: 9, lineHeight: 14 },
  footer: { marginTop: 20, textAlign: "center", color: COLORS.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
});
