import { Ionicons } from "@expo/vector-icons";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { clearPendingInvite, savePendingInvite } from "../../auth/pendingInvite";
import { AppButton } from "../../components/AppButton";
import { LoadingView } from "../../components/LoadingView";
import { Screen } from "../../components/Screen";
import { colors, radii, spacing, typography } from "../../theme";
import type { AppStackParamList, ShareInvitePreview } from "../../types";

type InviteRoute = RouteProp<{ Invite: { token: string } }, "Invite">;

export function InviteScreen() {
  const route = useRoute<InviteRoute>();
  const navigation = useNavigation<any>();
  const { status } = useAuth();
  const [preview, setPreview] = useState<ShareInvitePreview>();
  const [error, setError] = useState<string>();
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (status === "signedOut") void savePendingInvite(route.params.token);
    void api.shareInvitePreview(route.params.token).then(setPreview).catch((value) => setError((value as ApiError).message));
  }, [route.params.token, status]);

  const accept = async () => {
    setAccepting(true); setError(undefined);
    try {
      const result = await api.acceptShareInvite(route.params.token);
      await clearPendingInvite();
      navigation.replace("SharedJourney", { journeyId: result.journeyId } satisfies AppStackParamList["SharedJourney"]);
    } catch (value) { setError((value as ApiError).message); }
    finally { setAccepting(false); }
  };

  if (!preview && !error) return <LoadingView label="Opening private commute..." />;
  return (
    <Screen>
      <View style={styles.mark}><Ionicons name="navigate" size={26} color={colors.lime} /></View>
      {preview ? <>
        <Text style={[typography.hero, styles.title]}>{preview.travelerName} shared a commute.</Text>
        <Text style={typography.body}>Sign in to follow the journey to {preview.destinationLabel}. This invitation is private and tied to your account after acceptance.</Text>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>SHARED COMMUTE</Text>
          <Text style={typography.title}>{preview.title}</Text>
          <View style={styles.destination}><Ionicons name="location" size={18} color={colors.forest} /><Text style={styles.destinationText}>{preview.destinationLabel}</Text></View>
          <View style={styles.privacy}><Ionicons name="eye-off-outline" size={18} color={colors.moss} /><Text style={styles.privacyText}>You can view timing, check-ins, and a coarse area. Precise location, notes, and journey controls remain private.</Text></View>
        </View>
        {status === "signedIn" ? <AppButton label={preview.invitationStatus === "accepted" ? "Open shared commute" : "Accept and view commute"} icon="arrow-forward" loading={accepting} onPress={() => void accept()} /> : <View style={styles.actions}>
          <AppButton label="Create an account" icon="person-add-outline" onPress={() => navigation.navigate("SignUp")} />
          <AppButton label="I already have an account" variant="secondary" onPress={() => navigation.navigate("SignIn")} />
          <Text style={styles.authNote}>Apple, Google, and email options are available on the next screen.</Text>
        </View>}
      </> : <View style={styles.unavailable}><Ionicons name="link-outline" size={30} color={colors.moss} /><Text style={typography.title}>Invitation unavailable</Text></View>}
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  mark: { width: 56, height: 56, borderRadius: 19, backgroundColor: colors.forest, alignItems: "center", justifyContent: "center" },
  title: { marginTop: spacing.xl, marginBottom: 10 },
  card: { marginVertical: spacing.xl, padding: 20, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.xl, gap: 12 },
  eyebrow: { ...typography.eyebrow, color: colors.moss },
  destination: { flexDirection: "row", alignItems: "center", gap: 8 },
  destinationText: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: "700" },
  privacy: { marginTop: 5, flexDirection: "row", gap: 9, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  privacyText: { ...typography.small, flex: 1, lineHeight: 19 },
  actions: { gap: spacing.md },
  authNote: { ...typography.small, textAlign: "center" },
  error: { color: colors.danger, marginTop: spacing.lg, fontWeight: "600", lineHeight: 20 },
  unavailable: { marginTop: 60, alignItems: "center", gap: 12 },
});
