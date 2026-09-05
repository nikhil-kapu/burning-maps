import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { AppButton } from "../../components/AppButton";
import { Screen } from "../../components/Screen";
import { openConfiguredLink } from "../../externalLinks";
import { colors, radii, spacing, typography } from "../../theme";
import type { AppStackParamList } from "../../types";

export function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { user, signOut } = useAuth();
  return (
    <Screen>
      <Text style={typography.eyebrow}>ACCOUNT</Text>
      <View style={styles.profile}><View style={styles.avatar}><Text style={styles.initial}>{user?.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={{ flex: 1 }}><Text style={typography.title}>{user?.displayName}</Text><Text style={typography.small}>@{user?.username}</Text></View><Pressable style={styles.edit} onPress={() => navigation.navigate("EditProfile")}><Ionicons name="pencil" size={19} color={colors.forest} /></Pressable></View>
      <View style={styles.privacyCard}><View style={styles.privacyIcon}><Ionicons name="eye-off" size={22} color={colors.forest} /></View><View style={{ flex: 1 }}><Text style={typography.bodyStrong}>Privacy by default</Text><Text style={typography.small}>Location is collected only during active journeys and expires automatically.</Text></View></View>
      <View style={styles.group}><Text style={styles.groupTitle}>Account & security</Text><Row icon="person-outline" label="Personal details" value={user?.email} onPress={() => navigation.navigate("EditProfile")} />{user?.hasPassword && <Row icon="key-outline" label="Change password" onPress={() => navigation.navigate("ChangePassword")} />}<Row icon="trash-outline" label="Delete account" danger onPress={() => navigation.navigate("DeleteAccount")} /></View>
      <View style={styles.group}><Text style={styles.groupTitle}>Help & legal</Text><Row icon="help-circle-outline" label="Help center" onPress={() => void openConfiguredLink("Help center", process.env.EXPO_PUBLIC_SUPPORT_URL)} /><Row icon="shield-checkmark-outline" label="Privacy policy" onPress={() => navigation.navigate("Legal", { document: "privacy" })} /><Row icon="document-text-outline" label="Terms of use" onPress={() => navigation.navigate("Legal", { document: "terms" })} /></View>
      <AppButton label="Sign out" variant="secondary" onPress={() => void signOut()} />
      <Text style={styles.version}>Turtle Maps 1.0.0 · Maps that think ahead</Text>
    </Screen>
  );
}

function Row({ icon, label, value, onPress, danger = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; value?: string; onPress: () => void; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.row}><View style={styles.rowIcon}><Ionicons name={icon} size={20} color={danger ? colors.danger : colors.forest} /></View><View style={{ flex: 1 }}><Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>{value && <Text style={typography.small} numberOfLines={1}>{value}</Text>}</View><Ionicons name="chevron-forward" size={20} color={colors.moss} /></Pressable>;
}

const styles = StyleSheet.create({
  profile: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 15 },
  avatar: { width: 68, height: 68, borderRadius: 24, backgroundColor: colors.peach, alignItems: "center", justifyContent: "center" },
  initial: { color: colors.forest, fontSize: 28, fontWeight: "900" },
  edit: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  privacyCard: { marginTop: spacing.xl, backgroundColor: colors.sageSoft, borderRadius: radii.large, padding: 16, flexDirection: "row", gap: 12, alignItems: "center" },
  privacyIcon: { width: 46, height: 46, borderRadius: 17, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center" },
  group: { marginVertical: spacing.lg, backgroundColor: colors.paper, borderRadius: radii.large, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  groupTitle: { padding: 15, color: colors.moss, fontSize: 11, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  row: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowIcon: { width: 38, height: 38, borderRadius: 14, backgroundColor: colors.cream, alignItems: "center", justifyContent: "center" },
  rowLabel: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  version: { ...typography.small, textAlign: "center", marginTop: 18 },
});
