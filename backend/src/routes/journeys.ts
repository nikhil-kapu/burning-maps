import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getConfig, isAgentBriefAiLive } from "../config.js";
import { getPool } from "../db.js";
import { authenticate } from "../http/authenticate.js";
import { AppError } from "../http/errors.js";
import { decryptPrivateText, encryptPrivateText, hashOpaqueToken, randomToken } from "../security.js";
import { interpretJourneyBrief } from "../services/journey-brief.js";
import { createJourneyInvitations } from "../services/journey-sharing.js";
import { rankRouteCandidates, routeCandidateEvidenceSchema } from "../services/route-candidate-ranker.js";
import { decodeRoutePolyline, distanceMeters } from "../services/route-geometry.js";
import { missingRequiredWaypoints, normalizeViaWaypoints, type JourneyPreferences } from "../services/routes.js";

type JourneyRow = {
  id: string;
  user_id: string;
  title: string;
  origin_label: string | null;
  destination_label: string;
  destination_latitude: number | null;
  destination_longitude: number | null;
  travel_mode: "driving" | "public_transit" | "bus" | "subway" | "train" | "taxi" | "rideshare" | "walking" | "cycling";
  journey_preferences: JourneyPreferences;
  agent_instructions_ciphertext: string | null;
  companion_updates_enabled: boolean;
  companion_call_enabled: boolean;
  update_delay_threshold_minutes: number;
  route_last_duration_seconds: number | null;
  route_last_distance_meters: number | null;
  route_last_checked_at: Date | null;
  last_companion_update: string | null;
  last_companion_update_at: Date | null;
  expected_arrival_at: Date;
  check_in_interval_minutes: number;
  grace_minutes: number;
  voice_call_enabled: boolean;
  status: "planned" | "active" | "overdue" | "ended" | "cancelled";
  notes_ciphertext: string | null;
  share_token_ciphertext: string | null;
  started_at: Date | null;
  ended_at: Date | null;
  last_check_in_at: Date | null;
  next_check_in_at: Date | null;
  last_coarse_area: string | null;
  created_at: Date;
  contact_count?: string;
};

function deliveryCapabilities() {
  const config = getConfig();
  return {
    routeUpdatesLive: config.ROUTE_UPDATES_MODE === "google" && Boolean(config.GOOGLE_ROUTES_API_KEY),
    pushLive: config.PUSH_MODE === "expo",
    voiceCallsLive: config.VOICE_MODE === "vapi" && Boolean(config.VAPI_PRIVATE_KEY && config.VAPI_PHONE_NUMBER_ID && config.VAPI_ASSISTANT_ID),
    smsLive: config.SMS_MODE === "twilio" && Boolean(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_FROM_NUMBER),
    emailLive: config.EMAIL_MODE === "ses",
    publicShareLive: config.PUBLIC_BASE_URL.startsWith("https://"),
    agentBriefAiLive: isAgentBriefAiLive(config),
  };
}

function present(row: JourneyRow) {
  const shareToken = decryptPrivateText(row.share_token_ciphertext);
  const preferences: JourneyPreferences = {
    ...row.journey_preferences,
    viaWaypoints: normalizeViaWaypoints(row.journey_preferences.viaWaypoints ?? []),
  };
  return {
    id: row.id,
    title: row.title,
    originLabel: row.origin_label,
    destinationLabel: row.destination_label,
    destinationCoordinate: row.destination_latitude === null || row.destination_longitude === null ? null : {
      latitude: row.destination_latitude,
      longitude: row.destination_longitude,
    },
    travelMode: row.travel_mode,
    preferences,
    agentInstructions: decryptPrivateText(row.agent_instructions_ciphertext),
    companionUpdatesEnabled: row.companion_updates_enabled,
    companionCallEnabled: row.companion_call_enabled,
    updateDelayThresholdMinutes: row.update_delay_threshold_minutes,
    routeDurationSeconds: row.route_last_duration_seconds,
    routeDistanceMeters: row.route_last_distance_meters,
    routeLastCheckedAt: row.route_last_checked_at,
    lastCompanionUpdate: row.last_companion_update,
    lastCompanionUpdateAt: row.last_companion_update_at,
    expectedArrivalAt: row.expected_arrival_at,
    checkInIntervalMinutes: row.check_in_interval_minutes,
    graceMinutes: row.grace_minutes,
    voiceCallEnabled: row.voice_call_enabled,
    status: row.status,
    notes: decryptPrivateText(row.notes_ciphertext),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lastCheckInAt: row.last_check_in_at,
    nextCheckInAt: row.next_check_in_at,
    lastCoarseArea: row.last_coarse_area,
    contactCount: Number(row.contact_count ?? 0),
    shareToken,
    shareUrl: shareToken ? `${getConfig().PUBLIC_BASE_URL}/s/${encodeURIComponent(shareToken)}` : null,
    deliveryCapabilities: deliveryCapabilities(),
    createdAt: row.created_at,
  };
}

const travelModeSchema = z.enum(["driving", "public_transit", "bus", "subway", "train", "taxi", "rideshare", "walking", "cycling"]);
const preferencesSchema = z.object({
  avoidTolls: z.boolean().default(false),
  avoidHighways: z.boolean().default(false),
  avoidFerries: z.boolean().default(false),
  fewerTransfers: z.boolean().default(false),
  quietRide: z.boolean().default(false),
  scenicRoute: z.boolean().optional(),
  saferStopsAfterDark: z.boolean().optional(),
  comfortStopAfterMinutes: z.number().int().min(15).max(360).optional(),
  viaWaypoints: z.array(z.string().trim().min(2).max(120)).max(3).optional(),
});

const routeSelectionSchema = z.object({
  candidateId: z.string().trim().min(1).max(80),
  label: z.string().trim().min(2).max(40),
  rationale: z.string().trim().min(2).max(240),
  durationSeconds: z.number().int().min(1).max(7 * 24 * 60 * 60),
  distanceMeters: z.number().min(1).max(20_000_000),
  waypointLabels: z.array(z.string().trim().min(2).max(160)).max(6),
  routeNames: z.array(z.string().trim().min(1).max(160)).max(12),
  routePolyline: z.string().min(8).max(96_000).optional(),
  routeWaypoints: z.array(z.object({
    label: z.string().trim().min(2).max(160),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    role: z.enum(["required", "agent"]),
    purpose: z.string().trim().min(2).max(160).optional(),
  })).max(6).optional(),
  navigationSteps: z.array(z.object({
    instruction: z.string().trim().min(1).max(500),
    distanceMeters: z.number().min(0).max(2_000_000),
    coordinate: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }),
  })).max(200).optional(),
});

const createSchema = z.object({
  title: z.string().trim().min(2).max(80),
  originLabel: z.string().trim().min(2).max(120).nullable().optional(),
  destinationLabel: z.string().trim().min(2).max(120),
  destinationCoordinate: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  travelMode: travelModeSchema,
  preferences: preferencesSchema.optional().default({ avoidTolls: false, avoidHighways: false, avoidFerries: false, fewerTransfers: false, quietRide: false }),
  agentInstructions: z.string().trim().max(1500).nullable().optional(),
  companionUpdatesEnabled: z.boolean(),
  companionCallEnabled: z.boolean(),
  updateDelayThresholdMinutes: z.number().int().min(5).max(120),
  expectedArrivalAt: z.coerce.date(),
  checkInIntervalMinutes: z.number().int().min(10).max(360),
  graceMinutes: z.number().int().min(5).max(120),
  voiceCallEnabled: z.boolean(),
  notes: z.string().trim().max(1000).nullable().optional(),
  contactIds: z.array(z.string().uuid()).max(5),
}).refine((value) => value.expectedArrivalAt.getTime() > Date.now() + 10 * 60_000, {
  message: "Arrival time must be at least 10 minutes from now.",
  path: ["expectedArrivalAt"],
}).refine((value) => value.expectedArrivalAt.getTime() < Date.now() + 30 * 24 * 60 * 60_000, {
  message: "Journeys can be planned up to 30 days ahead.",
  path: ["expectedArrivalAt"],
});

async function ownedJourney(id: string, userId: string, lock = false): Promise<JourneyRow | null> {
  const result = await getPool().query<JourneyRow>(
    `SELECT j.*, (SELECT count(*) FROM journey_contacts jc WHERE jc.journey_id = j.id) AS contact_count
     FROM journeys j WHERE j.id = $1 AND j.user_id = $2 ${lock ? "FOR UPDATE" : ""}`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}

export async function journeyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request) => {
    const query = z.object({ status: z.enum(["planned", "active", "overdue", "ended", "cancelled"]).optional() }).parse(request.query);
    const result = await getPool().query<JourneyRow>(
      `SELECT j.*, (SELECT count(*) FROM journey_contacts jc WHERE jc.journey_id = j.id) AS contact_count
       FROM journeys j WHERE j.user_id = $1 AND ($2::text IS NULL OR j.status = $2)
       ORDER BY CASE WHEN j.status IN ('active','overdue') THEN 0 WHEN j.status = 'planned' THEN 1 ELSE 2 END, j.created_at DESC
       LIMIT 100`,
      [request.auth.userId, query.status ?? null],
    );
    return { data: result.rows.map(present) };
  });

  app.get("/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const journey = await ownedJourney(params.id, request.auth.userId);
    if (!journey) throw new AppError(404, "JOURNEY_NOT_FOUND", "That journey was not found.");
    const contacts = await getPool().query(
      `SELECT c.id, c.name, c.relationship, c.phone_e164 AS "phoneE164", c.email, c.priority, c.channels
       FROM safety_contacts c JOIN journey_contacts jc ON jc.contact_id = c.id
       WHERE jc.journey_id = $1 ORDER BY c.priority`,
      [journey.id],
    );
    return { data: { ...present(journey), contacts: contacts.rows } };
  });

  app.post("/:id/route-candidates/rank", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ candidates: z.array(routeCandidateEvidenceSchema).min(1).max(10) }).parse(request.body);
    const journey = await ownedJourney(params.id, request.auth.userId);
    if (!journey) throw new AppError(404, "JOURNEY_NOT_FOUND", "That journey was not found.");
    const objective = journey.journey_preferences.routeObjective ?? {
      label: "Best match",
      summary: "Balance the route with the traveler's required places.",
      detourBudgetPercent: 35,
      rankingCriteria: ["travel time", "distance", "required places"],
      suggestedAnchors: [],
    };
    const ranking = await rankRouteCandidates({
      instructions: decryptPrivateText(journey.agent_instructions_ciphertext) ?? objective.summary,
      objective,
      candidates: body.candidates,
    });
    return { data: ranking };
  });

  app.post("/:id/route-selection", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = routeSelectionSchema.parse(request.body);
    const journey = await ownedJourney(params.id, request.auth.userId);
    if (!journey) throw new AppError(404, "JOURNEY_NOT_FOUND", "That journey was not found.");
    if (journey.status !== "planned") throw new AppError(409, "JOURNEY_ALREADY_STARTED", "Choose a route before starting the journey.");
    const missingWaypoints = missingRequiredWaypoints(journey.journey_preferences.viaWaypoints ?? [], body.waypointLabels);
    if (missingWaypoints.length) {
      throw new AppError(400, "ROUTE_MISSING_REQUIRED_PLACE", `The selected route no longer includes ${formatPlaceList(missingWaypoints)}. Rebuild the route options.`);
    }
    validateSelectedRouteGeometry(body, journey);
    const preferences: JourneyPreferences = {
      ...journey.journey_preferences,
      viaWaypoints: normalizeViaWaypoints(journey.journey_preferences.viaWaypoints ?? []),
      selectedRoute: body,
    };
    const result = await getPool().query<JourneyRow>(
      `UPDATE journeys
       SET journey_preferences = $3::jsonb,
           route_last_duration_seconds = $4,
           route_last_distance_meters = $5,
           route_last_checked_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'planned'
       RETURNING *`,
      [journey.id, request.auth.userId, JSON.stringify(preferences), body.durationSeconds, body.distanceMeters],
    );
    const updated = result.rows[0];
    if (!updated) throw new AppError(409, "JOURNEY_ALREADY_STARTED", "Choose a route before starting the journey.");
    await getPool().query(
      "INSERT INTO journey_events (journey_id, user_id, event_type, payload) VALUES ($1,$2,'route_selected',$3)",
      [journey.id, request.auth.userId, JSON.stringify({ candidateId: body.candidateId, label: body.label, durationSeconds: body.durationSeconds, distanceMeters: body.distanceMeters })],
    );
    updated.contact_count = journey.contact_count;
    return { data: present(updated) };
  });

  app.post("/", async (request, reply) => {
    const body = createSchema.parse(request.body);
    let inferredPreferences;
    try {
      inferredPreferences = await interpretJourneyBrief(body.agentInstructions, body.preferences, {
        originLabel: body.originLabel ?? "Current location",
        destinationLabel: body.destinationLabel,
        travelMode: body.travelMode,
      });
    } catch {
      throw new AppError(503, "ROUTE_BRIEF_UNAVAILABLE", "The route agent could not understand that brief right now. Try again in a moment.");
    }
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const contacts = await client.query<{ id: string }>(
        "SELECT id FROM safety_contacts WHERE user_id = $1 AND enabled = true AND id = ANY($2::uuid[])",
        [request.auth.userId, body.contactIds],
      );
      if (contacts.rowCount !== new Set(body.contactIds).size) {
        throw new AppError(400, "CONTACT_SELECTION_INVALID", "One or more selected safety contacts are unavailable.");
      }
      const shareToken = randomToken(32);
      const result = await client.query<JourneyRow>(
        `INSERT INTO journeys (
           user_id, title, origin_label, destination_label, destination_latitude, destination_longitude,
           travel_mode, journey_preferences, agent_instructions_ciphertext, companion_updates_enabled, companion_call_enabled,
           update_delay_threshold_minutes, expected_arrival_at,
           check_in_interval_minutes, grace_minutes, voice_call_enabled, notes_ciphertext,
           share_token_hash, share_token_ciphertext
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [
          request.auth.userId,
          body.title,
          body.originLabel ?? null,
          body.destinationLabel,
          body.destinationCoordinate.latitude,
          body.destinationCoordinate.longitude,
          body.travelMode,
          JSON.stringify(inferredPreferences),
          encryptPrivateText(body.agentInstructions),
          body.companionUpdatesEnabled,
          body.companionCallEnabled,
          body.updateDelayThresholdMinutes,
          body.expectedArrivalAt,
          body.checkInIntervalMinutes,
          body.graceMinutes,
          body.voiceCallEnabled,
          encryptPrivateText(body.notes),
          hashOpaqueToken(shareToken),
          encryptPrivateText(shareToken),
        ],
      );
      const journey = result.rows[0]!;
      for (const contactId of new Set(body.contactIds)) {
        await client.query("INSERT INTO journey_contacts (journey_id, contact_id) VALUES ($1, $2)", [journey.id, contactId]);
      }
      await client.query(
        "INSERT INTO journey_events (journey_id, user_id, event_type, payload) VALUES ($1,$2,'journey_created',$3)",
        [journey.id, request.auth.userId, JSON.stringify({ contactCount: contacts.rowCount })],
      );
      await client.query("COMMIT");
      journey.share_token_ciphertext = encryptPrivateText(shareToken);
      journey.contact_count = String(contacts.rowCount ?? 0);
      return reply.status(201).send({ data: present(journey) });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/:id/start", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [request.auth.userId]);
      const otherActive = await client.query(
        "SELECT 1 FROM journeys WHERE user_id=$1 AND id<>$2 AND status IN ('active','overdue') LIMIT 1",
        [request.auth.userId, params.id],
      );
      if (otherActive.rowCount) throw new AppError(409, "ACTIVE_JOURNEY_EXISTS", "End your current journey before starting another one.");
      const result = await client.query<JourneyRow & { phone_e164: string | null }>(
        `SELECT j.*, u.phone_e164 FROM journeys j JOIN users u ON u.id = j.user_id
         WHERE j.id = $1 AND j.user_id = $2 FOR UPDATE`,
        [params.id, request.auth.userId],
      );
      const journey = result.rows[0];
      if (!journey) throw new AppError(404, "JOURNEY_NOT_FOUND", "That journey was not found.");
      if (journey.status !== "planned") throw new AppError(409, "JOURNEY_ALREADY_STARTED", "This journey is not waiting to start.");
      if (journey.expected_arrival_at.getTime() <= Date.now()) throw new AppError(409, "ARRIVAL_TIME_PASSED", "Update the arrival time before starting.");
      if (!journey.phone_e164) {
        throw new AppError(409, "PHONE_REQUIRED_FOR_SHARING", "Add your phone number in your profile before sharing a journey with trusted people.");
      }
      const updated = await client.query<JourneyRow>(
        `UPDATE journeys SET status='active', started_at=now(), last_check_in_at=now(),
           next_check_in_at=LEAST(expected_arrival_at, now() + make_interval(mins => check_in_interval_minutes)), updated_at=now()
         WHERE id=$1 RETURNING *`,
        [journey.id],
      );
      await client.query("INSERT INTO journey_events (journey_id,user_id,event_type) VALUES ($1,$2,'journey_started')", [journey.id, request.auth.userId]);
      await createJourneyInvitations({ client, journeyId: journey.id, senderUserId: request.auth.userId, expectedArrivalAt: journey.expected_arrival_at });
      await client.query("COMMIT");
      return { data: present(updated.rows[0]!) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/:id/cancel", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await getPool().query<JourneyRow>(
      `UPDATE journeys SET status='cancelled', ended_at=now(), next_check_in_at=NULL, updated_at=now()
       WHERE id=$1 AND user_id=$2 AND status='planned' RETURNING *`,
      [params.id, request.auth.userId],
    );
    const journey = result.rows[0];
    if (!journey) throw new AppError(409, "JOURNEY_NOT_PLANNED", "Only a planned journey can be cancelled.");
    await getPool().query(
      "INSERT INTO journey_events (journey_id,user_id,event_type) VALUES ($1,$2,'journey_cancelled')",
      [journey.id, request.auth.userId],
    );
    return { data: present(journey) };
  });

  app.post("/:id/check-in", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ note: z.string().trim().max(240).nullable().optional() }).parse(request.body ?? {});
    const result = await getPool().query<JourneyRow>(
      `UPDATE journeys SET status='active', last_check_in_at=now(),
         next_check_in_at=LEAST(expected_arrival_at, now() + make_interval(mins => check_in_interval_minutes)), updated_at=now()
       WHERE id=$1 AND user_id=$2 AND status IN ('active','overdue') RETURNING *`,
      [params.id, request.auth.userId],
    );
    const journey = result.rows[0];
    if (!journey) throw new AppError(409, "JOURNEY_NOT_ACTIVE", "This journey is no longer active.");
    await getPool().query(
      "INSERT INTO journey_events (journey_id,user_id,event_type,payload) VALUES ($1,$2,'traveler_checked_in',$3)",
      [journey.id, request.auth.userId, JSON.stringify(body.note ? { note: body.note } : {})],
    );
    await getPool().query(
      "UPDATE escalation_actions SET status='cancelled', updated_at=now() WHERE journey_id=$1 AND stage<>'journey_share' AND status IN ('pending','failed')",
      [journey.id],
    );
    return { data: present(journey) };
  });

  app.post("/:id/location", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracyMeters: z.number().min(0).max(10000).nullable().optional(),
      coarseArea: z.string().trim().min(2).max(120).nullable().optional(),
      recordedAt: z.coerce.date(),
    }).parse(request.body);
    const active = await getPool().query<{ id: string }>(
      "SELECT id FROM journeys WHERE id=$1 AND user_id=$2 AND status IN ('active','overdue')",
      [params.id, request.auth.userId],
    );
    if (!active.rowCount) throw new AppError(409, "JOURNEY_NOT_ACTIVE", "Location updates require an active journey.");
    await getPool().query(
      `INSERT INTO journey_locations (journey_id,user_id,latitude,longitude,accuracy_meters,coarse_area,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [params.id, request.auth.userId, body.latitude, body.longitude, body.accuracyMeters ?? null, body.coarseArea ?? null, body.recordedAt],
    );
    if (body.coarseArea) await getPool().query("UPDATE journeys SET last_coarse_area=$1, updated_at=now() WHERE id=$2", [body.coarseArea, params.id]);
    return reply.status(202).send({ data: { accepted: true } });
  });

  app.post("/:id/extend", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ expectedArrivalAt: z.coerce.date() }).parse(request.body);
    if (body.expectedArrivalAt.getTime() <= Date.now() + 5 * 60_000) throw new AppError(400, "ARRIVAL_TIME_INVALID", "Choose a future arrival time.");
    const result = await getPool().query<JourneyRow>(
      `UPDATE journeys SET expected_arrival_at=$3,
         next_check_in_at=LEAST($3, now() + make_interval(mins => check_in_interval_minutes)),
         status='active', updated_at=now()
       WHERE id=$1 AND user_id=$2 AND status IN ('active','overdue') RETURNING *`,
      [params.id, request.auth.userId, body.expectedArrivalAt],
    );
    const journey = result.rows[0];
    if (!journey) throw new AppError(409, "JOURNEY_NOT_ACTIVE", "This journey is no longer active.");
    await getPool().query("UPDATE escalation_actions SET status='cancelled', updated_at=now() WHERE journey_id=$1 AND stage<>'journey_share' AND status IN ('pending','failed')", [journey.id]);
    await getPool().query("INSERT INTO journey_events (journey_id,user_id,event_type) VALUES ($1,$2,'arrival_extended')", [journey.id, request.auth.userId]);
    return { data: present(journey) };
  });

  app.post("/:id/end", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await getPool().query<JourneyRow>(
      `UPDATE journeys SET status='ended', ended_at=now(), next_check_in_at=NULL, updated_at=now()
       WHERE id=$1 AND user_id=$2 AND status IN ('active','overdue') RETURNING *`,
      [params.id, request.auth.userId],
    );
    const journey = result.rows[0];
    if (!journey) throw new AppError(409, "JOURNEY_NOT_ACTIVE", "This journey is no longer active.");
    await getPool().query("UPDATE escalation_actions SET status='cancelled', updated_at=now() WHERE journey_id=$1 AND stage<>'journey_share' AND status IN ('pending','failed')", [journey.id]);
    await getPool().query("INSERT INTO journey_events (journey_id,user_id,event_type) VALUES ($1,$2,'journey_ended')", [journey.id, request.auth.userId]);
    return { data: present(journey) };
  });

  app.post("/:id/call-me", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ idempotencyKey: z.string().uuid() }).parse(request.body);
    const result = await getPool().query<{ phone_e164: string | null; title: string }>(
      `SELECT u.phone_e164, j.title FROM journeys j JOIN users u ON u.id=j.user_id
       WHERE j.id=$1 AND j.user_id=$2 AND j.status IN ('active','overdue')`,
      [params.id, request.auth.userId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(409, "JOURNEY_NOT_ACTIVE", "This journey is no longer active.");
    if (!row.phone_e164) throw new AppError(409, "PHONE_REQUIRED", "Add your phone number before requesting a call.");
    await getPool().query(
      `INSERT INTO escalation_actions (journey_id,user_id,stage,channel,idempotency_key)
       VALUES ($1,$2,'manual_alert','voice',$3) ON CONFLICT (idempotency_key) DO NOTHING`,
      [params.id, request.auth.userId, `manual-call:${request.auth.userId}:${body.idempotencyKey}`],
    );
    return reply.status(202).send({ data: { queued: true, deliveryMode: deliveryCapabilities().voiceCallsLive ? "live" : "simulated" } });
  });

  app.post("/:id/simulate-companion-update", async (request, reply) => {
    if (getConfig().NODE_ENV === "production") throw new AppError(404, "NOT_FOUND", "Route not found.");
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      idempotencyKey: z.string().uuid(),
      summary: z.string().trim().min(10).max(240).default("Traffic changed along your route and your estimated arrival is about 20 minutes later."),
    }).parse(request.body);
    const result = await getPool().query<{ user_id: string; companion_updates_enabled: boolean; companion_call_enabled: boolean; phone_e164: string | null }>(
      `SELECT j.user_id,j.companion_updates_enabled,j.companion_call_enabled,u.phone_e164
       FROM journeys j JOIN users u ON u.id=j.user_id
       WHERE j.id=$1 AND j.user_id=$2 AND j.status IN ('active','overdue')`,
      [params.id, request.auth.userId],
    );
    const journey = result.rows[0];
    if (!journey) throw new AppError(409, "JOURNEY_NOT_ACTIVE", "Start the journey before testing a route-agent update.");
    if (!journey.companion_updates_enabled) throw new AppError(409, "COMPANION_UPDATES_DISABLED", "Route-agent updates are not enabled for this journey.");
    const channels: Array<"push" | "voice"> = ["push"];
    if (journey.companion_call_enabled && journey.phone_e164) channels.push("voice");
    for (const channel of channels) {
      await getPool().query(
        `INSERT INTO escalation_actions (journey_id,user_id,stage,channel,idempotency_key,payload)
         VALUES ($1,$2,'journey_update',$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`,
        [params.id, journey.user_id, channel, `companion-test:${body.idempotencyKey}:${channel}`, JSON.stringify({ summary: body.summary })],
      );
    }
    await getPool().query(
      `UPDATE journeys SET last_companion_update=$2,last_companion_update_at=now(),updated_at=now() WHERE id=$1`,
      [params.id, body.summary],
    );
    return reply.status(202).send({ data: { queued: true, channels } });
  });

  app.post("/:id/alert", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ holdConfirmed: z.literal(true), idempotencyKey: z.string().uuid(), message: z.string().trim().max(240).nullable().optional() }).parse(request.body);
    const journey = await ownedJourney(params.id, request.auth.userId);
    if (!journey || !["active", "overdue"].includes(journey.status)) throw new AppError(409, "JOURNEY_NOT_ACTIVE", "Start a journey before alerting your safety circle.");
    const contacts = await getPool().query<{ id: string; channels: string[]; invitation_id: string | null }>(
      `SELECT c.id, c.channels, i.id AS invitation_id FROM safety_contacts c JOIN journey_contacts jc ON jc.contact_id=c.id
       LEFT JOIN journey_share_invitations i ON i.journey_id=jc.journey_id AND i.contact_id=c.id
       WHERE jc.journey_id=$1 AND c.enabled=true`,
      [journey.id],
    );
    for (const contact of contacts.rows) {
      for (const channel of contact.channels.filter((value) => value === "sms" || value === "email")) {
        await getPool().query(
          `INSERT INTO escalation_actions (journey_id,user_id,contact_id,invitation_id,stage,channel,idempotency_key,payload)
           VALUES ($1,$2,$3,$4,'manual_alert',$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING`,
          [journey.id, request.auth.userId, contact.id, contact.invitation_id, channel, `manual-alert:${body.idempotencyKey}:${contact.id}:${channel}`, JSON.stringify(body.message ? { message: body.message } : {})],
        );
      }
    }
    await getPool().query(
      "INSERT INTO journey_events (journey_id,user_id,event_type,payload) VALUES ($1,$2,'manual_alert_requested',$3)",
      [journey.id, request.auth.userId, JSON.stringify(body.message ? { message: body.message } : {})],
    );
    const capabilities = deliveryCapabilities();
    const channels = contacts.rows.flatMap((contact) => contact.channels.filter((value) => value === "sms" || value === "email"));
    const liveChannels = channels.filter((channel) => channel === "sms" ? capabilities.smsLive : capabilities.emailLive).length;
    const deliveryMode = liveChannels === channels.length ? "live" : liveChannels === 0 ? "simulated" : "mixed";
    return reply.status(202).send({ data: { queued: true, recipientCount: contacts.rowCount, deliveryMode } });
  });
}

function formatPlaceList(values: string[]): string {
  if (values.length < 2) return values[0] ?? "a required stop";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function validateSelectedRouteGeometry(selection: z.infer<typeof routeSelectionSchema>, journey: JourneyRow): void {
  if (!selection.routePolyline) return;
  let coordinates;
  try {
    coordinates = decodeRoutePolyline(selection.routePolyline);
  } catch {
    throw new AppError(400, "ROUTE_GEOMETRY_INVALID", "The selected route line is invalid. Rebuild the route options and try again.");
  }
  const destination = journey.destination_latitude === null || journey.destination_longitude === null ? null : {
    latitude: journey.destination_latitude,
    longitude: journey.destination_longitude,
  };
  if (destination && distanceMeters(coordinates.at(-1)!, destination) > 10_000) {
    throw new AppError(400, "ROUTE_GEOMETRY_DESTINATION_MISMATCH", "The selected route line does not reach this destination. Rebuild the route options and try again.");
  }
  for (const waypoint of selection.routeWaypoints ?? []) {
    const coordinate = { latitude: waypoint.latitude, longitude: waypoint.longitude };
    const nearestRouteDistance = coordinates.reduce((nearest, routeCoordinate) => Math.min(nearest, distanceMeters(routeCoordinate, coordinate)), Number.POSITIVE_INFINITY);
    if (nearestRouteDistance > 15_000) {
      throw new AppError(400, "ROUTE_GEOMETRY_WAYPOINT_MISMATCH", `The selected route line does not pass near ${waypoint.label}. Rebuild the route options and try again.`);
    }
  }
}
