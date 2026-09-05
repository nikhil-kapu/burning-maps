import { useUser } from "@clerk/expo";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { AppButton } from "../../components/AppButton";
import { Screen } from "../../components/Screen";
import { TextField } from "../../components/TextField";
import { formatUsPhone, isCompleteUsPhone, toUsE164 } from "../../phone";
import { colors, radii, spacing, typography } from "../../theme";
import type { AppStackParamList } from "../../types";

export function EditProfileScreen({ navigation }: NativeStackScreenProps<AppStackParamList, "EditProfile">) {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.displayName ?? "");
  const [phone, setPhone] = useState(formatUsPhone(user?.phoneE164 ?? ""));
  const [emergencyNumber, setEmergencyNumber] = useState(user?.emergencyNumber ?? "");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!name.trim()) return setError("Add your name.");
    if (phone.trim() && !isCompleteUsPhone(phone)) return setError("Enter a 10-digit US phone number.");
    if (emergencyNumber.trim() && !/^[0-9+*#]{2,20}$/.test(emergencyNumber.trim())) return setError("Use the emergency number exactly as you would dial it.");
    setSaving(true); setError(undefined);
    try { const next = await api.updateMe({ displayName: name.trim(), phoneE164: toUsE164(phone), emergencyNumber: emergencyNumber.trim() || null }); await updateUser(next); navigation.goBack(); }
    catch (value) { setError((value as ApiError).message); }
    finally { setSaving(false); }
  };
  return <Screen safeTop={false}><Text style={typography.eyebrow}>PERSONAL DETAILS</Text><Text style={[typography.hero, styles.title]}>Make it yours.</Text><Text style={typography.body}>Your phone number is required only when you share a commute or enable wellness calls. It is never shown to trusted viewers.</Text><View style={styles.form}><TextField accessibilityLabel="Your US phone number" label="Your US phone number" icon="call-outline" value={phone} onChangeText={(value) => setPhone(formatUsPhone(value))} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel" maxLength={14} placeholder="(415) 555-1234" hint="Enter 10 digits. We add +1 automatically and store the number securely." /><TextField label="Display name" icon="person-outline" value={name} onChangeText={setName} autoCapitalize="words" /><TextField label="Local emergency number" icon="medical-outline" value={emergencyNumber} onChangeText={setEmergencyNumber} keyboardType="phone-pad" placeholder="911, 112, 999..." hint="Confirm this number for your current destination. Turtle Maps never calls it automatically." /><View style={styles.locked}><Text style={styles.lockedLabel}>EMAIL</Text><Text style={typography.bodyStrong}>{user?.email}</Text><Text style={typography.small}>Contact support to change a verified email in this release.</Text></View>{error && <Text style={styles.error}>{error}</Text>}<AppButton label="Save details" loading={saving} onPress={() => void submit()} /></View></Screen>;
}

export function ChangePasswordScreen({ navigation }: NativeStackScreenProps<AppStackParamList, "ChangePassword">) {
  const { user: clerkUser } = useUser();
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [confirm, setConfirm] = useState(""); const [error, setError] = useState<string>(); const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (next.length < 12 || !/[A-Z]/.test(next) || !/[a-z]/.test(next) || !/\d/.test(next)) return setError("Use 12+ characters with uppercase, lowercase, and a number.");
    if (next !== confirm) return setError("The new passwords do not match.");
    setSaving(true); setError(undefined);
    try {
      if (!clerkUser) throw new Error("Your identity session is not available. Sign in again.");
      await clerkUser.updatePassword({ currentPassword: current, newPassword: next, signOutOfOtherSessions: true });
      await api.passwordChanged();
      navigation.goBack();
    }
    catch (value) { setError((value as ApiError).message || "We could not change your password."); }
    finally { setSaving(false); }
  };
  return <Screen safeTop={false}><Text style={typography.eyebrow}>SECURITY</Text><Text style={[typography.hero, styles.title]}>Change your password.</Text><Text style={typography.body}>Other devices will be signed out. This device stays connected.</Text><View style={styles.form}><TextField label="Current password" icon="lock-open-outline" value={current} onChangeText={setCurrent} secureTextEntry /><TextField label="New password" icon="lock-closed-outline" value={next} onChangeText={setNext} secureTextEntry textContentType="newPassword" /><TextField label="Confirm new password" icon="shield-checkmark-outline" value={confirm} onChangeText={setConfirm} secureTextEntry textContentType="newPassword" />{error && <Text style={styles.error}>{error}</Text>}<AppButton label="Change password" loading={saving} onPress={() => void submit()} /></View></Screen>;
}

export function DeleteAccountScreen(): React.JSX.Element {
  const { deleteLocalSession, user } = useAuth();
  const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState(""); const [error, setError] = useState<string>(); const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (confirmation !== "DELETE") return setError("Type DELETE exactly to confirm.");
    setSaving(true); setError(undefined);
    try { await api.deleteAccount(password); await deleteLocalSession(); }
    catch (value) { setError((value as ApiError).message); }
    finally { setSaving(false); }
  };
  return <Screen safeTop={false}><Text style={typography.eyebrow}>ACCOUNT DELETION</Text><Text style={[typography.hero, styles.title]}>Delete Turtle Maps data.</Text><View style={styles.warning}><Text style={typography.bodyStrong}>This cannot be undone.</Text><Text style={typography.small}>Your account, selected people, journeys, location history, sessions, and pending notifications will be deleted.</Text></View><View style={styles.form}>{user?.hasPassword && <TextField label="Password" icon="lock-closed-outline" value={password} onChangeText={setPassword} secureTextEntry />}<TextField label="Type DELETE" icon="trash-outline" value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" />{error && <Text style={styles.error}>{error}</Text>}<AppButton label="Permanently delete account" variant="danger" loading={saving} onPress={() => void submit()} /></View></Screen>;
}

const styles = StyleSheet.create({
  title: { marginTop: 7, marginBottom: 9 },
  form: { marginTop: spacing.xl, gap: spacing.lg },
  locked: { backgroundColor: colors.paper, borderRadius: radii.large, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 5 },
  lockedLabel: { color: colors.moss, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  warning: { marginTop: spacing.lg, backgroundColor: "#FFE1DA", borderRadius: radii.large, padding: 16, gap: 5 },
  error: { color: colors.danger, fontWeight: "600" },
});
