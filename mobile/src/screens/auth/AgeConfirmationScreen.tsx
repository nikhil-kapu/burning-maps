import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { AppButton } from "../../components/AppButton";
import { BrandMark } from "../../components/BrandMark";
import { Screen } from "../../components/Screen";
import { colors, radii, spacing, typography } from "../../theme";

export function AgeConfirmationScreen() {
  const { updateUser, signOut } = useAuth();
  const [underAge, setUnderAge] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const confirm = async () => {
    setLoading(true);
    setError(undefined);
    try {
      await updateUser(await api.confirmAge());
    } catch (value) {
      setError(value instanceof ApiError ? value.message : "We could not save your answer. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll={false} dark style={styles.screen}>
      <BrandMark inverse compact />
      <View style={styles.routeMark} accessibilityElementsHidden>
        <View style={styles.routeLine} />
        <View style={styles.routeDot} />
        <View style={styles.routePin}><Ionicons name="navigate" size={24} color={colors.forestDeep} /></View>
      </View>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>ONE QUICK CHECK</Text>
        <Text style={styles.title}>{underAge ? "Turtle Maps is currently 18+." : "Are you 18 or older?"}</Text>
        <Text style={styles.body}>{underAge ? "The current safety and trusted-contact experience is designed for adults arranging their own travel." : "We ask once after account creation—not every time you sign in."}</Text>
      </View>
      <View style={styles.actions}>
        {underAge ? (
          <>
            <AppButton label="Back" variant="secondary" onPress={() => setUnderAge(false)} />
            <AppButton label="Sign out" variant="ghost" onPress={() => void signOut()} />
          </>
        ) : (
          <>
            {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <AppButton label="Yes, continue" icon="arrow-forward" loading={loading} onPress={() => void confirm()} />
            <AppButton label="No, I’m under 18" variant="ghost" onPress={() => setUnderAge(true)} />
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: 18, paddingBottom: 22 },
  routeMark: { height: 172, marginTop: spacing.xl, position: "relative" },
  routeLine: { position: "absolute", left: 20, right: 22, top: 84, height: 3, backgroundColor: colors.sageSoft, transform: [{ rotate: "-8deg" }] },
  routeDot: { position: "absolute", left: 14, top: 92, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.accent },
  routePin: { position: "absolute", right: 46, top: 48, width: 54, height: 54, borderRadius: 27, backgroundColor: colors.sand, alignItems: "center", justifyContent: "center", transform: [{ rotate: "18deg" }] },
  copy: { gap: 10 },
  eyebrow: { ...typography.eyebrow, color: colors.sageSoft },
  title: { ...typography.hero, color: colors.white, fontSize: 38, lineHeight: 41 },
  body: { ...typography.body, color: colors.sageSoft, maxWidth: 340 },
  actions: { marginTop: "auto", borderRadius: radii.large, backgroundColor: colors.cream, padding: spacing.md, gap: 7 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, fontWeight: "600", padding: 4 },
});
