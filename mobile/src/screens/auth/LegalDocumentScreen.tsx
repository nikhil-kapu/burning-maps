import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Screen } from "../../components/Screen";
import { colors, radii, spacing, typography } from "../../theme";
import type { AuthStackParamList } from "../../types";

type Document = {
  title: string;
  intro: string;
  sections: Array<{ title: string; body: string }>;
};

const documents: Record<"terms" | "privacy", Document> = {
  terms: {
    title: "Terms of Use",
    intro: "These terms explain the current Turtle Maps service and the responsibilities that come with using it.",
    sections: [
      { title: "Who can use Turtle Maps", body: "Turtle Maps is currently intended for people who are at least 18 years old and can enter into these terms for themselves." },
      { title: "A travel tool, not emergency response", body: "Turtle Maps can help plan journeys, monitor chosen updates, and contact people you designate. It is not an emergency service, does not guarantee safety or connectivity, and never automatically calls emergency services." },
      { title: "Your choices and permissions", body: "You control when a journey starts, whether location tracking is active, which contacts receive updates, and whether informational calls are enabled. Keep contact details accurate and obtain permission before adding another person." },
      { title: "Your account", body: "Protect your sign-in credentials and use the app lawfully. You can sign out or request deletion of your Turtle Maps account and associated journey data from the profile screen." },
      { title: "Service changes", body: "Routes, arrival estimates, communications, and third-party provider availability can change. Always use your judgment and follow official travel and emergency guidance." },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    intro: "Turtle Maps is designed to reveal only what a journey needs, for only as long as it is useful.",
    sections: [
      { title: "Information you provide", body: "We process your account details, journey preferences, destinations, selected contacts, check-ins, and the instructions you give the route agent." },
      { title: "Location during a journey", body: "Precise location is requested only when you use a location feature or start tracking an active journey. Trusted viewers receive timing, check-ins, and a coarse area—not your precise location or private notes." },
      { title: "How information is used", body: "Information supports authentication, route planning, meaningful journey updates, requested calls or messages, fraud prevention, and service reliability. Turtle Maps does not sell personal information." },
      { title: "Service providers", body: "Authentication, mapping, notifications, email, SMS, and voice features may use configured providers. They receive only the information needed to perform the requested function." },
      { title: "Your controls", body: "You can stop a journey, disable permissions, remove trusted contacts, revoke sharing, update account details, or delete your account from the app." },
    ],
  },
};

export function LegalDocumentScreen({ navigation, route }: NativeStackScreenProps<AuthStackParamList, "Legal">) {
  const document = documents[route.params.document];
  return (
    <Screen style={styles.screen}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={styles.back}>
        <Ionicons name="arrow-back" size={21} color={colors.forest} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={typography.eyebrow}>TURTLE MAPS</Text>
      <Text style={[typography.hero, styles.title]}>{document.title}</Text>
      <Text style={styles.updated}>Effective August 26, 2026</Text>
      <Text style={styles.intro}>{document.intro}</Text>
      <View style={styles.sections}>
        {document.sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={typography.bodyStrong}>{section.title}</Text>
            <Text style={styles.body}>{section.body}</Text>
          </View>
        ))}
      </View>
      <View style={styles.reviewNote}>
        <Ionicons name="document-text-outline" size={20} color={colors.moss} />
        <Text style={styles.reviewText}>This in-app copy must receive final legal review before public release.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: 8 },
  back: { minHeight: 44, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.lg },
  backText: { color: colors.forest, fontWeight: "800", fontSize: 15 },
  title: { marginTop: 7 },
  updated: { ...typography.small, marginTop: 8 },
  intro: { ...typography.body, color: colors.moss, marginTop: spacing.lg },
  sections: { marginTop: spacing.xl, gap: spacing.xl },
  section: { gap: 7 },
  body: { ...typography.body, color: colors.textMuted },
  reviewNote: { marginTop: spacing.xl, borderRadius: radii.medium, backgroundColor: colors.sageSoft, padding: 15, flexDirection: "row", gap: 10, alignItems: "center" },
  reviewText: { ...typography.small, color: colors.moss, flex: 1 },
});
