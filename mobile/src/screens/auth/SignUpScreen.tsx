import { useSignUp } from "@clerk/expo";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { clerkErrorMessage, throwClerkError } from "../../auth/clerkErrors";
import { AppButton } from "../../components/AppButton";
import { BrandMark } from "../../components/BrandMark";
import { LegalAgreement } from "../../components/LegalAgreement";
import { Screen } from "../../components/Screen";
import { SocialAuthButtons } from "../../components/SocialAuthButtons";
import { TextField } from "../../components/TextField";
import { colors, spacing, typography } from "../../theme";
import type { AuthStackParamList } from "../../types";

type Props = NativeStackScreenProps<AuthStackParamList, "SignUp">;

export function SignUpScreen({ navigation }: Props) {
  const { signUp, fetchStatus } = useSignUp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(undefined);
    if (!email.trim() || !password) return setError("Enter your email and create a password.");
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      return setError("Use 12+ characters with uppercase, lowercase, and a number.");
    }
    setLoading(true);
    try {
      const result = await signUp.password({
        emailAddress: email.trim(),
        password,
        legalAccepted: true,
        unsafeMetadata: {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles",
        },
      });
      throwClerkError(result.error, "We could not create your account.");
      throwClerkError((await signUp.verifications.sendEmailCode()).error, "We could not send the verification code.");
      navigation.replace("VerifyEmail", { email: email.trim() });
    } catch (value) {
      setError(clerkErrorMessage(value, "We could not create your account."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen style={styles.screen}>
      <BrandMark compact />
      <View style={styles.heading}>
        <Text style={typography.eyebrow}>START IN UNDER A MINUTE</Text>
        <Text style={typography.hero}>Create your account.</Text>
        <Text style={styles.subhead}>Google is fastest. Email only needs a password—your profile can wait until you plan a journey.</Text>
      </View>
      <View style={styles.form}>
        <SocialAuthButtons onError={setError} />
        <TextField label="Email" icon="mail-outline" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" />
        <TextField label="Create a password" icon="lock-closed-outline" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" returnKeyType="done" onSubmitEditing={() => void submit()} hint="12+ characters with uppercase, lowercase, and a number" />
        <View nativeID="clerk-captcha" />
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <AppButton label="Create account" icon="arrow-forward" loading={loading || fetchStatus === "fetching"} onPress={() => void submit()} />
      </View>
      <View style={styles.footer}><Text style={typography.small}>Already have an account?</Text><Pressable onPress={() => navigation.navigate("SignIn")} hitSlop={10}><Text style={styles.link}>Sign in</Text></Pressable></View>
      <LegalAgreement onTerms={() => navigation.navigate("Legal", { document: "terms" })} onPrivacy={() => navigation.navigate("Legal", { document: "privacy" })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: 12 },
  heading: { marginTop: 38, gap: 9 },
  subhead: { ...typography.body, color: colors.textMuted, maxWidth: 340 },
  form: { marginTop: spacing.lg, gap: spacing.md },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  footer: { minHeight: 44, flexDirection: "row", justifyContent: "center", gap: 7, marginTop: 16, alignItems: "center" },
  link: { color: colors.forest, fontSize: 15, fontWeight: "800" },
});
