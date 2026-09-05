import { getConfig } from "../config.js";

export async function sendSms(input: { to: string; body: string }): Promise<{ providerId: string }> {
  const config = getConfig();
  if (config.SMS_MODE === "disabled") {
    console.info("SMS disabled", { toSuffix: input.to.slice(-4), body: input.body });
    return { providerId: `disabled-sms-${Date.now()}` };
  }
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN || !config.TWILIO_FROM_NUMBER) {
    throw new Error("Twilio SMS is selected but its backend-only configuration is incomplete.");
  }
  const params = new URLSearchParams({ To: input.to, From: config.TWILIO_FROM_NUMBER, Body: input.body });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.TWILIO_ACCOUNT_SID)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );
  const body = (await response.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!response.ok) throw new Error(body.message ?? `Twilio SMS failed with ${response.status}.`);
  return { providerId: body.sid ?? `twilio-${Date.now()}` };
}

