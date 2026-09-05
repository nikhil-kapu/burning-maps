import { getConfig } from "./config.js";
import { getPool } from "./db.js";
import { getEscalationStages } from "./domain.js";
import { decryptPrivateText } from "./security.js";
import { sendEmail } from "./services/email.js";
import { sendPush } from "./services/push.js";
import { getRouteSnapshot, type JourneyPreferences, type TravelMode } from "./services/routes.js";
import { sendSms } from "./services/sms.js";
import { placeJourneyUpdateCall, placeWellnessCall } from "./services/voice.js";

type DueJourney = {
  id: string;
  user_id: string;
  title: string;
  destination_label: string;
  next_check_in_at: Date;
  grace_minutes: number;
  voice_call_enabled: boolean;
};

type BriefReminderJourney = {
  id: string;
  user_id: string;
  companion_call_enabled: boolean;
  phone_e164: string | null;
  journey_preferences: JourneyPreferences;
};

type Action = {
  id: string;
  journey_id: string;
  user_id: string;
  contact_id: string | null;
  invitation_id: string | null;
  stage: "traveler_push" | "traveler_voice" | "contact_notice" | "manual_alert" | "journey_update" | "journey_share";
  channel: "push" | "voice" | "sms" | "email";
  attempt_count: number;
  title: string;
  destination_label: string;
  share_token_ciphertext: string | null;
  invitation_token_ciphertext: string | null;
  display_name: string;
  traveler_email: string;
  traveler_phone: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  payload: { summary?: string; message?: string };
};

export function buildJourneyShareMessage(input: { travelerName: string; destinationLabel: string; contactName?: string | null; inviteUrl: string }): string {
  return `${input.travelerName} shared a commute to ${input.destinationLabel} with you on Turtle Maps. Open the commute: ${input.inviteUrl}. Sign in or create an account with Apple, Google, or email. This private link is for ${input.contactName ?? "you"}; please do not forward it.`;
}

async function enqueueAction(input: {
  journeyId: string;
  userId: string;
  contactId?: string;
  invitationId?: string;
  stage: Action["stage"];
  channel: Action["channel"];
  cycle: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const key = [input.journeyId, input.cycle, input.stage, input.contactId ?? "traveler", input.channel].join(":");
  await getPool().query(
    `INSERT INTO escalation_actions (journey_id,user_id,contact_id,invitation_id,stage,channel,idempotency_key,payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (idempotency_key) DO NOTHING`,
    [input.journeyId, input.userId, input.contactId ?? null, input.invitationId ?? null, input.stage, input.channel, key, JSON.stringify(input.payload ?? {})],
  );
}

type MonitoredJourney = {
  id: string;
  user_id: string;
  title: string;
  display_name: string;
  timezone: string;
  phone_e164: string | null;
  destination_latitude: number;
  destination_longitude: number;
  travel_mode: TravelMode;
  journey_preferences: JourneyPreferences;
  companion_call_enabled: boolean;
  update_delay_threshold_minutes: number;
  route_baseline_eta_at: Date | null;
  route_last_update_call_at: Date | null;
  latitude: number;
  longitude: number;
};

function arrivalLabel(value: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(value);
  } catch {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(value);
  }
}

function isAfterDark(value: Date, timezone: string): boolean {
  try {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(value));
    return hour >= 18 || hour < 6;
  } catch {
    const hour = value.getUTCHours();
    return hour >= 18 || hour < 6;
  }
}

export async function monitorJourneyChanges(now = new Date()): Promise<number> {
  if (getConfig().ROUTE_UPDATES_MODE === "disabled") return 0;
  const result = await getPool().query<MonitoredJourney>(
    `SELECT j.id,j.user_id,j.title,j.destination_latitude,j.destination_longitude,j.travel_mode,
            j.journey_preferences,j.companion_call_enabled,j.update_delay_threshold_minutes,
            j.route_baseline_eta_at,j.route_last_update_call_at,u.display_name,u.timezone,u.phone_e164,
            latest.latitude,latest.longitude
     FROM journeys j
     JOIN users u ON u.id=j.user_id
     JOIN LATERAL (
       SELECT latitude,longitude FROM journey_locations
       WHERE journey_id=j.id ORDER BY recorded_at DESC LIMIT 1
     ) latest ON true
     WHERE j.status IN ('active','overdue') AND j.companion_updates_enabled=true
       AND j.destination_latitude IS NOT NULL AND j.destination_longitude IS NOT NULL
       AND (j.route_last_checked_at IS NULL OR j.route_last_checked_at <= $1 - interval '5 minutes')
     ORDER BY j.route_last_checked_at NULLS FIRST LIMIT 50`,
    [now],
  );
  let checked = 0;
  for (const journey of result.rows) {
    try {
      const snapshot = await getRouteSnapshot({
        origin: { latitude: journey.latitude, longitude: journey.longitude },
        destination: { latitude: journey.destination_latitude, longitude: journey.destination_longitude },
        travelMode: journey.travel_mode,
        preferences: journey.journey_preferences,
      });
      if (!snapshot) continue;
      checked += 1;
      const currentEta = new Date(now.getTime() + snapshot.durationSeconds * 1000);
      const baselineEta = journey.route_baseline_eta_at;
      const delaySeconds = baselineEta ? Math.round((currentEta.getTime() - baselineEta.getTime()) / 1000) : 0;
      const significant = Boolean(baselineEta && delaySeconds >= journey.update_delay_threshold_minutes * 60);
      let summary: string | null = null;
      let voiceQueued = false;
      let signature: string | null = null;
      if (significant) {
        const delayMinutes = Math.max(journey.update_delay_threshold_minutes, Math.round(delaySeconds / 300) * 5);
        const lead = ["public_transit", "bus", "subway", "train"].includes(journey.travel_mode)
          ? "Your transit arrival has shifted"
          : ["driving", "taxi", "rideshare"].includes(journey.travel_mode)
            ? "Traffic or route conditions changed"
            : "Your route timing changed";
        summary = journey.journey_preferences.quietRide
          ? `Arrival is now around ${arrivalLabel(currentEta, journey.timezone)} after a delay of about ${delayMinutes} minutes.`
          : `${lead}, adding about ${delayMinutes} minutes. Your updated arrival is around ${arrivalLabel(currentEta, journey.timezone)}.`;
        if (journey.journey_preferences.saferStopsAfterDark && isAfterDark(now, journey.timezone)) {
          summary += " If you need to stop, choose a well-lit, populated place.";
        }
        signature = `${Math.floor(currentEta.getTime() / 600_000)}:${Math.floor(delayMinutes / 5)}`;
        await enqueueAction({ journeyId: journey.id, userId: journey.user_id, stage: "journey_update", channel: "push", cycle: signature, payload: { summary } });
        const callCooldownPassed = !journey.route_last_update_call_at || now.getTime() - journey.route_last_update_call_at.getTime() >= 45 * 60_000;
        if (journey.companion_call_enabled && journey.phone_e164 && callCooldownPassed) {
          await enqueueAction({ journeyId: journey.id, userId: journey.user_id, stage: "journey_update", channel: "voice", cycle: signature, payload: { summary } });
          voiceQueued = true;
        }
      }
      await getPool().query(
        `UPDATE journeys SET
           route_baseline_duration_seconds=CASE WHEN route_baseline_eta_at IS NULL OR $6::boolean THEN $2 ELSE route_baseline_duration_seconds END,
           route_baseline_eta_at=CASE WHEN route_baseline_eta_at IS NULL OR $6::boolean THEN $3 ELSE route_baseline_eta_at END,
           route_last_duration_seconds=$2,route_last_distance_meters=$4,route_last_checked_at=$1,
           route_last_update_call_at=CASE WHEN $7::boolean THEN $1 ELSE route_last_update_call_at END,
           route_last_signature=COALESCE($8,route_last_signature),
           last_companion_update=COALESCE($5,last_companion_update),
           last_companion_update_at=CASE WHEN $5::text IS NOT NULL THEN $1 ELSE last_companion_update_at END,
           updated_at=now()
         WHERE id=$9`,
        [now, snapshot.durationSeconds, currentEta, snapshot.distanceMeters, summary, significant, voiceQueued, signature, journey.id],
      );
      if (summary) {
        await getPool().query(
          "INSERT INTO journey_events (journey_id,user_id,event_type,payload) VALUES ($1,$2,'companion_route_update',$3)",
          [journey.id, journey.user_id, JSON.stringify({ summary, durationSeconds: snapshot.durationSeconds, distanceMeters: snapshot.distanceMeters })],
        );
      }
    } catch (error) {
      console.error("Journey route monitor failed", { journeyId: journey.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return checked;
}

export async function enqueueAgentBriefActions(now = new Date()): Promise<number> {
  const result = await getPool().query<BriefReminderJourney>(
    `SELECT j.id,j.user_id,j.companion_call_enabled,j.journey_preferences,u.phone_e164
     FROM journeys j JOIN users u ON u.id=j.user_id
     WHERE j.status IN ('active','overdue') AND j.companion_updates_enabled=true AND j.started_at IS NOT NULL
       AND jsonb_typeof(j.journey_preferences->'comfortStopAfterMinutes')='number'
       AND j.started_at + ((j.journey_preferences->>'comfortStopAfterMinutes')::integer * interval '1 minute') <= $1
       AND NOT EXISTS (
         SELECT 1 FROM journey_events e
         WHERE e.journey_id=j.id AND e.event_type='agent_brief_reminder' AND e.payload->>'kind'='comfort_stop'
       )
     ORDER BY j.started_at LIMIT 100`,
    [now],
  );
  for (const journey of result.rows) {
    const minutes = journey.journey_preferences.comfortStopAfterMinutes;
    if (!minutes) continue;
    const safetyNote = journey.journey_preferences.saferStopsAfterDark
      ? " Choose a well-lit, populated place if you stop after dark."
      : "";
    const summary = `You asked for a comfort or coffee break around ${minutes} minutes into this journey. This is a good time to choose a well-reviewed stop that fits your route.${safetyNote}`;
    const cycle = `agent-brief:comfort-stop:${minutes}`;
    await enqueueAction({ journeyId: journey.id, userId: journey.user_id, stage: "journey_update", channel: "push", cycle, payload: { summary } });
    if (journey.companion_call_enabled && journey.phone_e164) {
      await enqueueAction({ journeyId: journey.id, userId: journey.user_id, stage: "journey_update", channel: "voice", cycle, payload: { summary } });
    }
    await getPool().query(
      `INSERT INTO journey_events (journey_id,user_id,event_type,payload)
       VALUES ($1,$2,'agent_brief_reminder',$3)`,
      [journey.id, journey.user_id, JSON.stringify({ kind: "comfort_stop", minutes })],
    );
    await getPool().query(
      "UPDATE journeys SET last_companion_update=$2,last_companion_update_at=$3,updated_at=now() WHERE id=$1",
      [journey.id, summary, now],
    );
  }
  return result.rowCount ?? 0;
}

export async function enqueueDueEscalations(now = new Date()): Promise<number> {
  const result = await getPool().query<DueJourney>(
    `SELECT id,user_id,title,destination_label,next_check_in_at,grace_minutes,voice_call_enabled
     FROM journeys WHERE status IN ('active','overdue') AND next_check_in_at <= $1
     ORDER BY next_check_in_at LIMIT 100`,
    [now],
  );
  for (const journey of result.rows) {
    const overdueMinutes = Math.floor((now.getTime() - journey.next_check_in_at.getTime()) / 60_000);
    const stages = getEscalationStages({ overdueMinutes, graceMinutes: journey.grace_minutes, voiceEnabled: journey.voice_call_enabled });
    const cycle = journey.next_check_in_at.toISOString();
    await getPool().query("UPDATE journeys SET status='overdue', updated_at=now() WHERE id=$1 AND status='active'", [journey.id]);
    if (stages.includes("traveler_push")) {
      await enqueueAction({ journeyId: journey.id, userId: journey.user_id, stage: "traveler_push", channel: "push", cycle });
    }
    if (stages.includes("traveler_voice")) {
      await enqueueAction({ journeyId: journey.id, userId: journey.user_id, stage: "traveler_voice", channel: "voice", cycle });
    }
    if (stages.includes("contact_notice")) {
      const contacts = await getPool().query<{ id: string; channels: string[]; invitation_id: string | null }>(
        `SELECT c.id,c.channels,i.id AS invitation_id FROM safety_contacts c JOIN journey_contacts jc ON jc.contact_id=c.id
         LEFT JOIN journey_share_invitations i ON i.journey_id=jc.journey_id AND i.contact_id=c.id
         WHERE jc.journey_id=$1 AND c.enabled=true ORDER BY c.priority`,
        [journey.id],
      );
      for (const contact of contacts.rows) {
        for (const channel of contact.channels) {
          if (channel === "sms" || channel === "email") {
            await enqueueAction({ journeyId: journey.id, userId: journey.user_id, contactId: contact.id, invitationId: contact.invitation_id ?? undefined, stage: "contact_notice", channel, cycle });
          }
        }
      }
    }
  }
  return result.rowCount ?? 0;
}

async function claimActions(limit = 20): Promise<Action[]> {
  await getPool().query(
    `UPDATE escalation_actions SET status='failed', last_error='Delivery lease expired', next_attempt_at=now(), updated_at=now()
     WHERE status='processing' AND updated_at < now() - interval '5 minutes'`,
  );
  const result = await getPool().query<Action>(
    `WITH claimed AS (
       SELECT id FROM escalation_actions
       WHERE status IN ('pending','failed') AND next_attempt_at <= now() AND attempt_count < 6
       ORDER BY next_attempt_at, created_at
       FOR UPDATE SKIP LOCKED LIMIT $1
     )
     UPDATE escalation_actions a SET status='processing', updated_at=now()
     FROM claimed c
     WHERE a.id=c.id
     RETURNING a.*,
       (SELECT title FROM journeys WHERE id=a.journey_id),
       (SELECT destination_label FROM journeys WHERE id=a.journey_id),
       (SELECT share_token_ciphertext FROM journeys WHERE id=a.journey_id),
       (SELECT token_ciphertext FROM journey_share_invitations WHERE id=a.invitation_id) AS invitation_token_ciphertext,
       (SELECT display_name FROM users WHERE id=a.user_id),
       (SELECT email FROM users WHERE id=a.user_id) AS traveler_email,
       (SELECT phone_e164 FROM users WHERE id=a.user_id) AS traveler_phone,
       (SELECT name FROM safety_contacts WHERE id=a.contact_id) AS contact_name,
       (SELECT email FROM safety_contacts WHERE id=a.contact_id) AS contact_email,
       (SELECT phone_e164 FROM safety_contacts WHERE id=a.contact_id) AS contact_phone`,
    [limit],
  );
  return result.rows;
}

async function deliver(action: Action): Promise<{ providerId: string; status: "sent" | "simulated" | "cancelled" }> {
  const config = getConfig();
  if (action.channel === "push") {
    const tokens = await getPool().query<{ token: string }>("SELECT token FROM device_tokens WHERE user_id=$1 AND enabled=true", [action.user_id]);
    if (!tokens.rowCount) return { providerId: "no-device-token", status: "cancelled" };
    const ids: string[] = [];
    for (const row of tokens.rows) {
      const update = action.stage === "journey_update";
      const result = await sendPush({
        token: row.token,
        title: update ? "Your route agent found a change" : "Turtle Maps check-in",
        body: update ? (action.payload.summary ?? "Open Turtle Maps to review an update to your journey.") : `Your check-in for ${action.title} is due. Tap to let your selected people know you are okay.`,
        data: { journeyId: action.journey_id, screen: "ActiveJourney" },
      });
      ids.push(result.providerId);
    }
    return { providerId: ids.join(","), status: config.PUSH_MODE === "expo" ? "sent" : "simulated" };
  }
  if (action.channel === "voice") {
    if (!action.traveler_phone) throw new Error("Traveler phone number is missing.");
    if (action.stage === "journey_update") {
      const result = await placeJourneyUpdateCall({
        to: action.traveler_phone,
        travelerName: action.display_name,
        journeyTitle: action.title,
        updateSummary: action.payload.summary ?? "There is a meaningful change along your route. Open Turtle Maps when it is safe to review it.",
      });
      return { providerId: result.providerId, status: config.VOICE_MODE === "vapi" ? "sent" : "simulated" };
    }
    const result = await placeWellnessCall({ to: action.traveler_phone, travelerName: action.display_name, journeyTitle: action.title });
    return { providerId: result.providerId, status: config.VOICE_MODE === "vapi" ? "sent" : "simulated" };
  }
  const inviteToken = decryptPrivateText(action.invitation_token_ciphertext);
  const legacyToken = decryptPrivateText(action.share_token_ciphertext);
  const statusUrl = inviteToken
    ? `${getConfig().PUBLIC_BASE_URL}/invite/${encodeURIComponent(inviteToken)}`
    : legacyToken ? `${getConfig().PUBLIC_BASE_URL}/s/${encodeURIComponent(legacyToken)}` : getConfig().PUBLIC_BASE_URL;
  if (action.stage === "journey_share") {
    const message = buildJourneyShareMessage({ travelerName: action.display_name, destinationLabel: action.destination_label, contactName: action.contact_name, inviteUrl: statusUrl });
    if (action.channel === "sms") {
      if (!action.contact_phone) throw new Error("Contact phone number is missing.");
      const result = await sendSms({ to: action.contact_phone, body: message });
      return { providerId: result.providerId, status: config.SMS_MODE === "twilio" ? "sent" : "simulated" };
    }
    if (!action.contact_email) throw new Error("Contact email is missing.");
    const result = await sendEmail({ to: action.contact_email, subject: `${action.display_name} shared a Turtle Maps commute`, text: message });
    return { providerId: result.providerId, status: config.EMAIL_MODE === "ses" ? "sent" : "simulated" };
  }
  const travelerMessage = action.stage === "manual_alert" && action.payload.message
    ? ` Traveler message: ${action.payload.message}`
    : "";
  const message = `${action.display_name} asked Turtle Maps to keep you updated about ${action.title} to ${action.destination_label}. A check-in is overdue or the traveler requested contact.${travelerMessage} View the private status: ${statusUrl}. If you believe there is immediate danger, contact local emergency services directly.`;
  if (action.channel === "sms") {
    if (!action.contact_phone) throw new Error("Contact phone number is missing.");
    const result = await sendSms({ to: action.contact_phone, body: message });
    return { providerId: result.providerId, status: config.SMS_MODE === "twilio" ? "sent" : "simulated" };
  }
  if (!action.contact_email) throw new Error("Contact email is missing.");
  const result = await sendEmail({ to: action.contact_email, subject: `Turtle Maps update for ${action.display_name}`, text: message });
  return { providerId: result.providerId, status: config.EMAIL_MODE === "ses" ? "sent" : "simulated" };
}

export async function deliverPendingEscalations(): Promise<number> {
  const actions = await claimActions();
  for (const action of actions) {
    try {
      const delivery = await deliver(action);
      await getPool().query(
        `UPDATE escalation_actions SET status=$2, provider_id=$3, attempt_count=attempt_count+1, last_error=NULL, updated_at=now()
         WHERE id=$1`,
        [action.id, delivery.status, delivery.providerId],
      );
      await getPool().query(
        "INSERT INTO journey_events (journey_id,user_id,event_type,payload) VALUES ($1,$2,$3,$4)",
        [action.journey_id, action.user_id, delivery.status === "cancelled" ? "escalation_skipped" : delivery.status === "simulated" ? "escalation_simulated" : "escalation_sent", JSON.stringify({ stage: action.stage, channel: action.channel, providerId: delivery.providerId })],
      );
    } catch (error) {
      const attempts = action.attempt_count + 1;
      const delayMinutes = Math.min(60, 2 ** attempts);
      await getPool().query(
        `UPDATE escalation_actions SET status='failed', attempt_count=$2, last_error=$3,
           next_attempt_at=now() + make_interval(mins => $4), updated_at=now() WHERE id=$1`,
        [action.id, attempts, error instanceof Error ? error.message.slice(0, 500) : "Unknown delivery error", delayMinutes],
      );
    }
  }
  return actions.length;
}

export async function runRetentionCleanup(): Promise<void> {
  const config = getConfig();
  await getPool().query("DELETE FROM journey_locations WHERE created_at < now() - make_interval(days => $1)", [config.LOCATION_RETENTION_DAYS]);
  await getPool().query("DELETE FROM journey_events WHERE created_at < now() - make_interval(days => $1)", [config.EVENT_RETENTION_DAYS]);
}

export function startWorker(): () => void {
  let running = false;
  let cleanupTick = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await enqueueAgentBriefActions();
      await monitorJourneyChanges();
      await enqueueDueEscalations();
      await deliverPendingEscalations();
      cleanupTick += 1;
      if (cleanupTick >= 1440) {
        cleanupTick = 0;
        await runRetentionCleanup();
      }
    } catch (error) {
      console.error("Escalation worker tick failed", { message: error instanceof Error ? error.message : String(error) });
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
