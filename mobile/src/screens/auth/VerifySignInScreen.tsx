import { useSignIn } from "@clerk/expo";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { clerkErrorMessage, throwClerkError } from "../../auth/clerkErrors";
import { AppButton } from "../../components/AppButton";
import { BrandMark } from "../../components/BrandMark";
import { Screen } from "../../components/Screen";
import { colors, radii, spacing, typography } from "../../theme";
import type { AuthStackParamList } from "../../types";

type Props = NativeStackScreenProps<AuthStackParamList, "VerifySignIn">;

export function VerifySignInScreen({ route }: Props) {
  const { signIn, fetchStatus } = useSignIn();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [seconds, setSeconds] = useState(30);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) return setError("Enter the six-digit code.");
    setError(undefined);
    try {
      const result = route.params.factor === "email"
        ? await signIn.mfa.verifyEmailCode({ code })
        : await signIn.mfa.verifyPhoneCode({ code });
      throwClerkError(result.error, "That code did not work.");
      if (signIn.status !== "complete") throw new Error("Your account needs another verification step.");
      throwClerkError((await signIn.finalize()).error, "We could not finish signing you in.");
    } catch (value) {
      setError(clerkErrorMessage(value, "That code did not work."));
    }
  };

  const resend = async () => {
    if (seconds > 0) return;
    try {
      const result = route.params.factor === "email" ? await signIn.mfa.sendEmailCode() : await signIn.mfa.sendPhoneCode();
      throwClerkError(result.error, "We could not send another code.");
      setCode(""); setSeconds(30); setError(undefined);
    } catch (value) { setError(clerkErrorMessage(value, "We could not send another code.")); }
  };

  return (
    <Screen style={styles.screen}>
      <BrandMark />
      <View style={styles.icon}><Text style={styles.emoji}>{route.params.factor === "email" ? "✉" : "●"}</Text></View>
      <Text style={[typography.hero, styles.center]}>Confirm it’s you.</Text>
      <Text style={[typography.body, styles.center, styles.copy]}>We sent a code using the trusted {route.params.factor} on the account for <Text style={styles.strong}>{route.params.identifier}</Text>.</Text>
      <Pressable onPress={() => input.current?.focus()} style={styles.codeShell}>
        <TextInput ref={input} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} style={styles.hiddenInput} autoFocus />
        {Array.from({ length: 6 }).map((_, index) => <View key={index} style={[styles.digit, index === code.length && styles.digitActive]}><Text style={styles.digitText}>{code[index] ?? ""}</Text></View>)}
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      <AppButton label="Verify and sign in" loading={fetchStatus === "fetching"} onPress={() => void verify()} />
      <Pressable onPress={() => void resend()} disabled={seconds > 0} style={styles.resend}><Text style={[styles.resendText, seconds > 0 && styles.disabled]}>{seconds > 0 ? `Send another code in ${seconds}s` : "Send another code"}</Text></Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { alignItems: "stretch" },
  icon: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.peach, alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 52, marginBottom: 22 },
  emoji: { fontSize: 28, color: colors.forest },
  center: { textAlign: "center" },
  copy: { color: colors.textMuted, marginTop: 10 },
  strong: { color: colors.ink, fontWeight: "800" },
  codeShell: { flexDirection: "row", gap: 8, marginVertical: spacing.xl, justifyContent: "center" },
  hiddenInput: { position: "absolute", opacity: 0, width: 1, height: 1 },
  digit: { width: 44, height: 58, borderRadius: radii.medium, backgroundColor: colors.paper, borderWidth: 1.5, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  digitActive: { borderColor: colors.forest },
  digitText: { fontSize: 24, fontWeight: "800", color: colors.ink },
  error: { color: colors.danger, textAlign: "center", fontWeight: "600", marginBottom: 12 },
  resend: { minHeight: 48, justifyContent: "center", alignItems: "center" },
  resendText: { color: colors.forest, fontWeight: "800" },
  disabled: { color: colors.textMuted },
});
