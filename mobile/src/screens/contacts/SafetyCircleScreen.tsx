import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api, ApiError } from "../../api/client";
import { AppButton } from "../../components/AppButton";
import { LoadingView } from "../../components/LoadingView";
import { Screen } from "../../components/Screen";
import { colors, radii, shadow, spacing, typography } from "../../theme";
import type { AppStackParamList, SafetyContact } from "../../types";

export function SafetyCircleScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [contacts, setContacts] = useState<SafetyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => { try { setContacts(await api.contacts()); setError(undefined); } catch (value) { setError((value as ApiError).message); } finally { setLoading(false); } }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (loading) return <LoadingView label="Loading your safety circle..." />;
  return (
    <Screen>
      <View style={styles.header}><View><Text style={typography.eyebrow}>YOUR PEOPLE</Text><Text style={typography.hero}>Safety circle</Text></View><AppButton label="Add" icon="person-add" style={styles.add} onPress={() => navigation.navigate("AddContact")} /></View>
      <View style={styles.intro}><View style={styles.introIcon}><Ionicons name="people" size={26} color={colors.forest} /></View><View style={{ flex: 1 }}><Text style={typography.bodyStrong}>Only people you choose</Text><Text style={typography.small}>Contacts receive updates only for journeys you explicitly add them to.</Text></View></View>
      {error && <Text style={styles.error}>{error}</Text>}
      {contacts.length === 0 ? <View style={styles.empty}><Text style={styles.emptyEmoji}>🤝</Text><Text style={typography.section}>Add someone you trust</Text><Text style={[typography.body, styles.center]}>A friend, sibling, partner, parent, or anyone who should expect your check-in.</Text><AppButton label="Add my first contact" onPress={() => navigation.navigate("AddContact")} /></View> : (
        <View style={styles.list}>{contacts.map((contact, index) => <Pressable key={contact.id} onPress={() => navigation.navigate("AddContact", { contact })} style={({ pressed }) => [styles.contact, pressed && { opacity: 0.86 }]}><View style={[styles.avatar, { backgroundColor: [colors.peach, colors.sky, colors.mint][index % 3] }]}><Text style={styles.initial}>{contact.name.slice(0, 1).toUpperCase()}</Text></View><View style={{ flex: 1 }}><View style={styles.nameRow}><Text style={typography.bodyStrong}>{contact.name}</Text>{index === 0 && <View style={styles.primary}><Text style={styles.primaryText}>PRIMARY</Text></View>}</View><Text style={typography.small}>{contact.relationship} · {contact.channels.join(" + ")}</Text></View><Ionicons name="chevron-forward" size={21} color={colors.moss} /></Pressable>)}</View>
      )}
      <View style={styles.explainer}><Text style={typography.section}>What happens after a missed check-in?</Text><Step number="1" title="We remind you" copy="A push notification gives you time to respond." /><Step number="2" title="We call you, if enabled" copy="The wellness call comes before contact escalation." /><Step number="3" title="Your circle gets the update" copy="Only selected contacts receive the private journey link." /></View>
    </Screen>
  );
}

function Step({ number, title, copy }: { number: string; title: string; copy: string }) {
  return <View style={styles.step}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View><View style={{ flex: 1 }}><Text style={typography.bodyStrong}>{title}</Text><Text style={typography.small}>{copy}</Text></View></View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  add: { minHeight: 46, paddingHorizontal: 14 },
  intro: { marginTop: spacing.xl, flexDirection: "row", alignItems: "center", gap: 13, backgroundColor: colors.sageSoft, borderRadius: radii.large, padding: 16 },
  introIcon: { width: 48, height: 48, borderRadius: 17, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center" },
  list: { marginTop: spacing.lg, gap: 10 },
  contact: { ...shadow, backgroundColor: colors.paper, borderRadius: radii.large, borderWidth: 1, borderColor: colors.line, minHeight: 78, padding: 13, flexDirection: "row", alignItems: "center", gap: 13 },
  avatar: { width: 50, height: 50, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  initial: { color: colors.forest, fontSize: 19, fontWeight: "900" },
  nameRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  primary: { backgroundColor: colors.forest, borderRadius: radii.pill, paddingVertical: 3, paddingHorizontal: 7 },
  primaryText: { color: colors.white, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  empty: { marginTop: spacing.xl, backgroundColor: colors.paper, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.line, padding: 26, gap: 13, alignItems: "center" },
  emptyEmoji: { fontSize: 46 },
  center: { textAlign: "center", color: colors.textMuted },
  explainer: { marginTop: spacing.xl, gap: 18 },
  step: { flexDirection: "row", gap: 13, alignItems: "center" },
  stepNumber: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.forest, alignItems: "center", justifyContent: "center" },
  stepNumberText: { color: colors.lime, fontWeight: "900" },
  error: { marginTop: 14, color: colors.danger, fontWeight: "600" },
});
