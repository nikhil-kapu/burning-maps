export type JourneyStatus = "planned" | "active" | "overdue" | "ended" | "cancelled";
export type EscalationStage = "traveler_push" | "traveler_voice" | "contact_notice" | "manual_alert" | "journey_update" | "journey_share";
export type DeliveryChannel = "push" | "voice" | "sms" | "email";

export type AuthenticatedUser = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  timezone: string;
  phoneE164: string | null;
  emergencyNumber: string | null;
  hasPassword: boolean;
  ageConfirmed: boolean;
};

export type AuthContext = {
  userId: string;
  sessionId: string;
};

export function getEscalationStages(input: {
  overdueMinutes: number;
  graceMinutes: number;
  voiceEnabled: boolean;
}): EscalationStage[] {
  if (input.overdueMinutes < 0) return [];
  const stages: EscalationStage[] = ["traveler_push"];
  if (input.voiceEnabled && input.overdueMinutes >= Math.min(5, input.graceMinutes)) stages.push("traveler_voice");
  if (input.overdueMinutes >= input.graceMinutes) stages.push("contact_notice");
  return stages;
}

export function nextCheckInAt(now: Date, intervalMinutes: number, expectedArrivalAt: Date): Date {
  const next = new Date(now.getTime() + intervalMinutes * 60_000);
  return next > expectedArrivalAt ? expectedArrivalAt : next;
}
