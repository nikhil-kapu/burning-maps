import { useSignIn } from "@clerk/expo";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { clerkErrorMessage, throwClerkError } from "../../auth/clerkErrors";
import { AppButton } from "../../components/AppButton";
import { BrandMark } from "../../components/BrandMark";
import { LegalAgreement } from "../../components/LegalAgreement";
import { Screen } from "../../components/Screen";
import { TextField } from "../../components/TextField";
import { SocialAuthButtons } from "../../components/SocialAuthButtons";
import { normalizeSignInIdentifier } from "../../phone";
import { colors, spacing, typography } from "../../theme";
import type { AuthStackParamList } from "../../types";

type Props = NativeStackScreenProps<AuthStackParamList, "SignIn">;

export function SignInScreen({ navigation, route }: Props) {
  const { signIn, fetchStatus } = useSignIn();
  const [identifier, setIdentifier] = useState(route.params?.identifier ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setError(undefined);
    if (!identifier.trim() || !password) return setError("Enter your username, email, or phone and password.");
    const normalizedIdentifier = normalizeSignInIdentifier(identifier);
    setLoading(true);
    try {
      const result = await signIn.password({ identifier: normalizedIdentifier, password });
      throwClerkError(result.error, "We could not sign you in.");
      if (signIn.status === "complete") {
        throwClerkError((await signIn.finalize()).error, "We could not finish signing you in.");
        return;
      }
      if (signIn.status === "needs_client_trust" || signIn.status === "needs_second_factor") {
        const factors = signIn.supportedSecondFactors;
        if (factors.some((factor) => factor.strategy === "email_code")) {
          throwClerkError((await signIn.mfa.sendEmailCode()).error, "We could not send the verification code.");
          navigation.navigate("VerifySignIn", { identifier: normalizedIdentifier, factor: "email" });
          return;
        }
        if (factors.some((factor) => factor.strategy === "phone_code")) {
          throwClerkError((await signIn.mfa.sendPhoneCode()).error, "We could not send the verification code.");
          navigation.navigate("VerifySignIn", { identifier: normalizedIdentifier, factor: "phone" });
          return;
        }
      }
      throw new Error("This account needs an authentication step that is not available in this build.");
    } catch (value) {
      setError(clerkErrorMessage(value, "We could not sign you in."));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Screen style={styles.screen}>
      <BrandMark compact />
      <View style={styles.heading}>
        <Text style={typography.eyebrow}>YOUR MAP, YOUR ACCOUNT</Text>
        <Text style={typography.hero}>Welcome back.</Text>
        <Text style={styles.subhead}>Continue with Google, or use your Turtle Maps email and password.</Text>
      </View>
      <View style={styles.form}>
        <SocialAuthButtons onError={setError} />
        <TextField label="Username, email, or phone" icon="person-outline" value={identifier} onChangeText={setIdentifier} autoComplete="username" textContentType="username" returnKeyType="next" hint="For a US phone number, enter 10 digits—no +1 needed." />
        <TextField label="Password" icon="lock-closed-outline" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" returnKeyType="done" onSubmitEditing={() => void submit()} />
        {error && <Text style={styles.error}>{error}</Text>}
        <AppButton label="Continue" icon="arrow-forward" loading={loading || fetchStatus === "fetching"} onPress={() => void submit()} />
        <Pressable onPress={() => navigation.navigate("Recovery")} style={styles.link}><Text style={styles.linkText}>Forgot username or password?</Text></Pressable>
      </View>
      <View style={styles.footer}><Text style={typography.small}>New to Turtle Maps?</Text><Pressable onPress={() => navigation.navigate("SignUp")} hitSlop={10}><Text style={styles.linkText}>Create an account</Text></Pressable></View>
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
  link: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkText: { color: colors.forest, fontSize: 15, fontWeight: "800" },
  footer: { minHeight: 44, flexDirection: "row", justifyContent: "center", gap: 7, marginTop: 12, alignItems: "center" },
});
