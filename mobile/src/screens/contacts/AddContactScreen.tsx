import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { api, ApiError } from "../../api/client";
import { AppButton } from "../../components/AppButton";
import { Screen } from "../../components/Screen";
import { TextField } from "../../components/TextField";
import { formatUsPhone, isCompleteUsPhone, toUsE164 } from "../../phone";
import { colors, radii, spacing, typography } from "../../theme";
import type { AppStackParamList } from "../../types";

export function AddContactScreen({ route, navigation }: NativeStackScreenProps<AppStackParamList, "AddContact">) {
  const contact = route.params?.contact;
  const [name, setName] = useState(contact?.name ?? "");
  const [relationship, setRelationship] = useState(contact?.relationship ?? "");
  const [phone, setPhone] = useState(formatUsPhone(contact?.phoneE164 ?? ""));
  const [email, setEmail] = useState(contact?.email ?? "");
  const [channels, setChannels] = useState<Array<"sms" | "email">>(contact?.channels ?? []);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const toggle = (channel: "sms" | "email") => setChannels((current) => current.includes(channel) ? current.filter((value) => value !== channel) : [...current, channel]);
  const submit = async () => {
    if (!name.trim() || !relationship.trim()) return setError("Add a name and relationship.");
    if (!phone.trim() && !email.trim()) return setError("Add a phone number or email.");
    if (phone.trim() && !isCompleteUsPhone(phone)) return setError("Enter a 10-digit US phone number.");
    const phoneE164 = toUsE164(phone);
    const usableChannels = channels.filter((channel) => channel === "sms" ? Boolean(phoneE164) : Boolean(email.trim()));
    if (usableChannels.length === 0) return setError("Choose at least one notification channel with contact details.");
    setSaving(true); setError(undefined);
    const body = { name: name.trim(), relationship: relationship.trim(), phoneE164, email: email.trim() || null, priority: contact?.priority ?? 1, channels: usableChannels, enabled: true };
    try { if (contact) await api.updateContact(contact.id, body); else await api.createContact(body); navigation.goBack(); }
    catch (value) { setError((value as ApiError).message); }
    finally { setSaving(false); }
  };
  const remove = () => contact && Alert.alert("Remove this contact?", "They will no longer be available for new journey plans.", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: async () => { try { await api.deleteContact(contact.id); navigation.goBack(); } catch (value) { setError((value as ApiError).message); } } }]);
  return (
    <Screen safeTop={false}>
      <Text style={typography.eyebrow}>{contact ? "EDIT CONTACT" : "NEW TRAVEL CONTACT"}</Text><Text style={[typography.hero, styles.title]}>{contact ? "Keep their details current." : "Who should expect you?"}</Text><Text style={typography.body}>Turtle Maps contacts this person only for journeys you include them in.</Text>
      <View style={styles.form}>
        <TextField label="Name" icon="person-outline" value={name} onChangeText={setName} autoCapitalize="words" />
        <TextField label="Relationship" icon="heart-outline" value={relationship} onChangeText={setRelationship} autoCapitalize="words" placeholder="Sister, friend, partner..." />
        <TextField accessibilityLabel="Contact US phone number" label="US phone number" icon="call-outline" value={phone} onChangeText={(value) => setPhone(formatUsPhone(value))} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel" maxLength={14} placeholder="(415) 555-1234" hint="We add the +1 country code automatically." />
        <TextField label="Email (optional)" icon="mail-outline" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <View style={styles.channels}><Text style={styles.channelTitle}>How should we reach them?</Text><View style={styles.channelRow}><Channel label="Text message" selected={channels.includes("sms") && isCompleteUsPhone(phone)} disabled={!isCompleteUsPhone(phone)} onPress={() => toggle("sms")} /><Channel label="Email" selected={channels.includes("email") && Boolean(email.trim())} disabled={!email.trim()} onPress={() => toggle("email")} /></View></View>
        <View style={styles.consent}><Text style={typography.bodyStrong}>Ask before adding someone</Text><Text style={typography.small}>Make sure this person agrees to receive Turtle Maps journey updates and understands they are not an emergency service.</Text></View>
        {error && <Text style={styles.error}>{error}</Text>}
        <AppButton label={contact ? "Save changes" : "Add to my circle"} loading={saving} onPress={() => void submit()} />
        {contact && <AppButton label="Remove contact" variant="ghost" onPress={remove} />}
      </View>
    </Screen>
  );
}

function Channel({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.channel, selected && styles.channelSelected, disabled && styles.channelDisabled]}><Text style={[styles.channelText, selected && styles.channelTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  title: { marginTop: 7, marginBottom: 9 },
  form: { marginTop: spacing.xl, gap: spacing.lg },
  channels: { gap: 10 },
  channelTitle: { fontSize: 14, fontWeight: "800", color: colors.ink },
  channelRow: { flexDirection: "row", gap: 9 },
  channel: { minHeight: 48, flex: 1, borderRadius: radii.medium, backgroundColor: colors.paper, borderWidth: 1.5, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  channelSelected: { backgroundColor: colors.forest, borderColor: colors.forest },
  channelDisabled: { opacity: 0.35 },
  channelText: { color: colors.forest, fontWeight: "700" },
  channelTextSelected: { color: colors.white },
  consent: { backgroundColor: colors.sageSoft, borderRadius: radii.large, padding: 16, gap: 5 },
  error: { color: colors.danger, fontWeight: "600" },
});
