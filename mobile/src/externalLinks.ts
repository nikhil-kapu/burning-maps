import { Alert, Linking } from "react-native";

export async function openConfiguredLink(label: string, url: string | undefined): Promise<void> {
  if (!url || /REPLACE|YOUR_/i.test(url)) {
    Alert.alert(`${label} unavailable`, `This build does not have a ${label.toLowerCase()} URL configured yet.`);
    return;
  }
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error("Unsupported URL");
    await Linking.openURL(url);
  } catch {
    Alert.alert(`Could not open ${label.toLowerCase()}`, "Check your connection or contact Turtle Maps support.");
  }
}
