import { getConfig } from "../config.js";

async function placeVapiCall(input: {
  to: string;
  travelerName: string;
  journeyTitle: string;
  firstMessage: string;
  variables?: Record<string, string>;
}): Promise<{ providerId: string }> {
  const config = getConfig();
  if (config.VOICE_MODE === "disabled") {
    console.info("Voice call disabled", { journeyTitle: input.journeyTitle });
    return { providerId: `disabled-voice-${Date.now()}` };
  }
  if (!config.VAPI_PRIVATE_KEY || !config.VAPI_PHONE_NUMBER_ID || !config.VAPI_ASSISTANT_ID) {
    throw new Error("Vapi is selected but its backend-only configuration is incomplete.");
  }
  const response = await fetch("https://api.vapi.ai/call", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.VAPI_PRIVATE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistantId: config.VAPI_ASSISTANT_ID,
      phoneNumberId: config.VAPI_PHONE_NUMBER_ID,
      customer: { number: input.to },
      assistantOverrides: {
        variableValues: {
          travelerName: input.travelerName,
          journeyTitle: input.journeyTitle,
          ...input.variables,
        },
        firstMessage: input.firstMessage,
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok) throw new Error(body.message ?? `Vapi failed with ${response.status}.`);
  return { providerId: body.id ?? `vapi-${Date.now()}` };
}

export async function placeWellnessCall(input: {
  to: string;
  travelerName: string;
  journeyTitle: string;
}): Promise<{ providerId: string }> {
  return placeVapiCall({
    ...input,
    firstMessage: `Hi ${input.travelerName}, this is Turtle Maps checking in about ${input.journeyTitle}. Please open Turtle Maps to check in, extend your arrival time, or alert your selected people. If you are in immediate danger, contact local emergency services directly.`,
  });
}

export async function placeJourneyUpdateCall(input: {
  to: string;
  travelerName: string;
  journeyTitle: string;
  updateSummary: string;
}): Promise<{ providerId: string }> {
  return placeVapiCall({
    ...input,
    variables: { updateSummary: input.updateSummary },
    firstMessage: `Hi ${input.travelerName}, your Turtle Maps route agent has an informational update for ${input.journeyTitle}. ${input.updateSummary} Open the app when it is safe to review your journey. This call cannot contact your selected people or emergency services.`,
  });
}
