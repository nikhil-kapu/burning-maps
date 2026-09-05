import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api/client";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<"registered" | "denied" | "simulator" | "unconfigured"> {
  if (!Device.isDevice) return "simulator";
  const current = await Notifications.getPermissionsAsync();
  const permission = current.status === "granted" ? current : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") return "denied";
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId || projectId.startsWith("REPLACE")) return "unconfigured";
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api.registerDevice(token, Platform.OS === "android" ? "android" : "ios");
  return "registered";
}
