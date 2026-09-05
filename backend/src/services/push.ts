import { getConfig } from "../config.js";

export type PushMessage = {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
};

export async function sendPush(message: PushMessage): Promise<{ providerId: string }> {
  if (getConfig().PUSH_MODE === "console") {
    console.info("Development push", { tokenSuffix: message.token.slice(-8), title: message.title, body: message.body });
    return { providerId: `console-push-${Date.now()}` };
  }
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: message.token,
      sound: "default",
      title: message.title,
      body: message.body,
      data: message.data ?? {},
      priority: "high",
    }),
  });
  if (!response.ok) throw new Error(`Expo Push API failed with ${response.status}.`);
  const body = (await response.json()) as { data?: { id?: string; status?: string; message?: string } };
  if (body.data?.status === "error") throw new Error(body.data.message ?? "Expo Push API rejected the notification.");
  return { providerId: body.data?.id ?? `expo-${Date.now()}` };
}

