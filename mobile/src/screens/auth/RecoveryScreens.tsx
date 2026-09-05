import { useSignIn } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api, ApiError } from "../../api/client";
import { clerkErrorMessage, throwClerkError } from "../../auth/clerkErrors";
import { AppButton } from "../../components/AppButton";
import { BrandMark } from "../../components/BrandMark";
import { Screen } from "../../components/Screen";
import { TextField } from "../../components/TextField";
import { colors, radii, shadow, spacing, typography } from "../../theme";
import type { AuthStackParamList } from "../../types";

export function RecoveryScreen({ navigation }: NativeStackScreenProps<AuthStackParamList, "Recovery">) {
  return <Screen><BrandMark /><View style={styles.heading}><Text style={typography.hero}>Let’s get you back in.</Text><Text style={typography.body}>Choose what you need. We keep recovery responses private.</Text></View><View style={styles.options}><RecoveryOption icon="at" title="Forgot username" copy="We’ll send it to your verified email." onPress={() => navigation.navigate("ForgotUsername")} /><RecoveryOption icon="key" title="Forgot password" copy="Reset it with a short-lived email code." onPress={() => navigation.navigate("ForgotPassword")} /></View></Screen>;
}

function RecoveryOption({ icon, title, copy, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; copy: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.option, pressed && { opacity: 0.86 }]}><View style={styles.optionIcon}><Ionicons name={icon} size={22} color={colors.forest} /></View><View style={{ flex: 1 }}><Text style={typography.bodyStrong}>{title}</Text><Text style={[typography.small, { marginTop: 3 }]}>{copy}</Text></View><Ionicons name="chevron-forward" size={22} color={colors.moss} /></Pressable>;
}

function EmailRecovery({ mode, navigation }: { mode: "username" | "password"; navigation: Pick<NativeStackNavigationProp<AuthStackParamList>, "navigate"> }) {
  const { signIn, fetchStatus } = useSignIn();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (!email.includes("@")) return setError("Enter the email on your account.");
    setLoading(true); setError(undefined);
    try {
      if (mode === "username") setMessage((await api.forgotUsername(email.trim())).message);
      else {
        throwClerkError((await signIn.create({ identifier: email.trim() })).error, "We could not find that account.");
        throwClerkError((await signIn.resetPasswordEmailCode.sendCode()).error, "We could not send a reset code.");
        navigation.navigate("ResetPassword", { email: email.trim() });
      }
    } catch (value) { setError(mode === "username" ? ((value as ApiError).message ?? "Please try again.") : clerkErrorMessage(value, "Please try again.")); }
    finally { setLoading(false); }
  };
  return <Screen><BrandMark /><View style={styles.heading}><Text style={typography.hero}>{mode === "username" ? "Find your username." : "Reset your password."}</Text><Text style={typography.body}>{mode === "username" ? "We’ll email the username associated with your verified address. You can also sign in with email." : "We’ll send a six-digit reset code to your verified address."}</Text></View><View style={styles.form}><TextField label="Account email" icon="mail-outline" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />{error && <Text style={styles.error}>{error}</Text>}{message && <Text style={styles.success}>{message}</Text>}<AppButton label={mode === "username" ? "Email my username" : "Send reset code"} loading={loading || fetchStatus === "fetching"} onPress={() => void submit()} />{message && mode === "username" && <AppButton label="Back to sign in" variant="ghost" onPress={() => navigation.navigate("SignIn", { identifier: email })} />}</View></Screen>;
}

export function ForgotUsernameScreen({ navigation }: NativeStackScreenProps<AuthStackParamList, "ForgotUsername">) { return <EmailRecovery mode="username" navigation={navigation} />; }
export function ForgotPasswordScreen({ navigation }: NativeStackScreenProps<AuthStackParamList, "ForgotPassword">) { return <EmailRecovery mode="password" navigation={navigation} />; }

export function ResetPasswordScreen({ route, navigation }: NativeStackScreenProps<AuthStackParamList, "ResetPassword">) {
  const { signIn, fetchStatus } = useSignIn();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (!/^\d{6}$/.test(code)) return setError("Enter the six-digit reset code.");
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) return setError("Use 12+ characters with uppercase, lowercase, and a number.");
    if (password !== confirm) return setError("The passwords do not match.");
    setLoading(true); setError(undefined);
    try {
      throwClerkError((await signIn.resetPasswordEmailCode.verifyCode({ code })).error, "That reset code is invalid or expired.");
      throwClerkError((await signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions: true })).error, "We could not reset your password.");
      if (signIn.status === "complete") throwClerkError((await signIn.finalize()).error, "Your password changed, but sign-in did not finish.");
      else navigation.replace("SignIn", { identifier: route.params.email });
    }
    catch (value) { setError(clerkErrorMessage(value, "We could not reset your password.")); }
    finally { setLoading(false); }
  };
  return <Screen><BrandMark /><View style={styles.heading}><Text style={typography.hero}>Choose a new password.</Text><Text style={typography.body}>This signs out every other device using your account.</Text></View><View style={styles.form}><TextField label="Six-digit code" icon="keypad-outline" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" /><TextField label="New password" icon="lock-closed-outline" value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" /><TextField label="Confirm password" icon="shield-checkmark-outline" value={confirm} onChangeText={setConfirm} secureTextEntry textContentType="newPassword" />{error && <Text style={styles.error}>{error}</Text>}<AppButton label="Save new password" loading={loading || fetchStatus === "fetching"} onPress={() => void submit()} /></View></Screen>;
}

const styles = StyleSheet.create({
  heading: { marginTop: 42, gap: 10 },
  options: { marginTop: spacing.xl, gap: 14 },
  option: { ...shadow, minHeight: 96, backgroundColor: colors.paper, borderRadius: radii.large, borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", gap: 15, padding: 18 },
  optionIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.lime },
  form: { marginTop: spacing.xl, gap: spacing.md },
  error: { color: colors.danger, fontWeight: "600" },
  success: { color: colors.success, lineHeight: 21, fontWeight: "600" },
});
