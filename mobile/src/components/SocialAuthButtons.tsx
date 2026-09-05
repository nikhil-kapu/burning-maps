import { useSSO } from "@clerk/expo/experimental";
import React, { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { clerkErrorMessage } from "../auth/clerkErrors";
import { colors, spacing } from "../theme";
import { AppButton } from "./AppButton";

type Props = {
  onError?: (message: string | undefined) => void;
};

export function SocialAuthButtons({ onError }: Props) {
  const { startSSOFlow } = useSSO();
  const [busy, setBusy] = useState<"apple" | "google" | null>(null);
  const [localError, setLocalError] = useState<string>();
  const appleEnabled = process.env.EXPO_PUBLIC_CLERK_APPLE_ENABLED === "true";

  const fail = (message?: string) => {
    setLocalError(message);
    onError?.(message);
  };

  const start = async (provider: "apple" | "google") => {
    if (provider === "apple" && !appleEnabled) {
      fail("Apple sign-in needs the Apple credentials for this app before it can be enabled.");
      return;
    }
    setBusy(provider);
    fail(undefined);
    try {
      await startSSOFlow({
        strategy: provider === "google" ? "oauth_google" : "oauth_apple",
        redirectUrl: "turtlebuddy://sso-callback",
      });
    } catch (value) {
      fail(clerkErrorMessage(value, `We could not continue with ${provider === "google" ? "Google" : "Apple"}.`));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrapper}>
      <AppButton
        label="Continue with Google"
        icon="logo-google"
        variant="secondary"
        loading={busy === "google"}
        onPress={() => void start("google")}
      />
      {Platform.OS === "ios" && appleEnabled && (
        <AppButton
          label="Continue with Apple"
          icon="logo-apple"
          variant="secondary"
          loading={busy === "apple"}
          onPress={() => void start("apple")}
        />
      )}
      {localError && <Text accessibilityRole="alert" style={styles.error}>{localError}</Text>}
      <View style={styles.divider}><View style={styles.line} /><Text style={styles.or}>or use email</Text><View style={styles.line} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.md },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, fontWeight: "600" },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 2 },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  or: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
});
