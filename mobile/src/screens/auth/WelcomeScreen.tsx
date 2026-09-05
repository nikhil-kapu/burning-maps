import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../components/AppButton";
import { BrandMark } from "../../components/BrandMark";
import { colors, radii, spacing, typography } from "../../theme";
import type { AuthStackParamList } from "../../types";

type Props = NativeStackScreenProps<AuthStackParamList, "Welcome">;

export function WelcomeScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.hero}>
        <BrandMark inverse />
        <View style={styles.mapCanvas} accessibilityElementsHidden>
          <View style={[styles.route, styles.routeOne]} />
          <View style={[styles.route, styles.routeTwo]} />
          <View style={[styles.node, styles.nodeOne]} />
          <View style={[styles.node, styles.nodeTwo]} />
          <View style={styles.traveler}><Ionicons name="navigate" size={21} color={colors.forest} /></View>
          <View style={styles.expectedCard}>
            <View style={styles.avatar}><Text style={styles.avatarText}>A</Text></View>
            <View><Text style={styles.expectedLabel}>ARI IS EXPECTING YOU</Text><Text style={styles.expectedTime}>Check in by 8:30 PM</Text></View>
          </View>
        </View>
        <Text style={styles.heroTitle}>A map that gets{"\n"}how you travel.</Text>
        <Text style={styles.heroCopy}>Describe what matters once. Turtle plans around your preferences and stays alert to meaningful changes.</Text>
      </View>
      <View style={styles.actions}>
        <View style={styles.promiseRow}>
          <View style={styles.promiseIcon}><Ionicons name="shield-checkmark" size={18} color={colors.forest} /></View>
          <Text style={styles.promiseText}>Location sharing is off until you start a journey.</Text>
        </View>
        <AppButton label="Start planning" icon="arrow-forward" onPress={() => navigation.navigate("SignUp")} />
        <AppButton label="I already have an account" variant="ghost" onPress={() => navigation.navigate("SignIn")} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  hero: { flex: 1, backgroundColor: colors.forestDeep, margin: 12, marginBottom: 0, borderRadius: radii.xl, padding: spacing.lg, overflow: "hidden" },
  mapCanvas: { height: 205, marginTop: 22, position: "relative" },
  route: { position: "absolute", height: 3, backgroundColor: colors.mint, borderRadius: 2, transformOrigin: "left center" },
  routeOne: { width: 210, left: 28, top: 104, transform: [{ rotate: "-13deg" }] },
  routeTwo: { width: 104, left: 214, top: 58, transform: [{ rotate: "18deg" }] },
  node: { position: "absolute", width: 13, height: 13, borderRadius: 7, backgroundColor: colors.lime, borderWidth: 3, borderColor: colors.forestDeep },
  nodeOne: { left: 23, top: 103 },
  nodeTwo: { right: 14, top: 89 },
  traveler: { position: "absolute", left: 194, top: 54, width: 44, height: 44, borderRadius: 22, backgroundColor: colors.lime, alignItems: "center", justifyContent: "center", transform: [{ rotate: "22deg" }] },
  expectedCard: { position: "absolute", bottom: 1, left: 6, right: 6, borderRadius: radii.medium, backgroundColor: "#214A40", padding: 13, flexDirection: "row", gap: 11, alignItems: "center", borderWidth: 1, borderColor: "#37675B" },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.peach, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.forest, fontWeight: "900" },
  expectedLabel: { color: colors.mint, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  expectedTime: { color: colors.white, fontSize: 15, fontWeight: "700", marginTop: 3 },
  heroTitle: { ...typography.display, color: colors.white, fontSize: 39, lineHeight: 41, marginTop: 14 },
  heroCopy: { ...typography.body, color: colors.mint, marginTop: 13, maxWidth: 330 },
  actions: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 12, gap: 7 },
  promiseRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  promiseIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center" },
  promiseText: { ...typography.small, flex: 1, color: colors.moss },
});
