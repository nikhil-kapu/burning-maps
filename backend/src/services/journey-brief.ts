import { z } from "zod";
import { getConfig } from "../config.js";
import { inferJourneyPreferences, normalizeViaWaypoints, type AgentRouteObjective, type JourneyPreferences, type TravelMode } from "./routes.js";

export type JourneyBriefContext = {
  originLabel: string;
  destinationLabel: string;
  travelMode: TravelMode;
};

const interpretedSchema = z.object({
  avoidTolls: z.boolean(),
  avoidHighways: z.boolean(),
  avoidFerries: z.boolean(),
  fewerTransfers: z.boolean(),
  quietRide: z.boolean(),
  scenicRoute: z.boolean(),
  saferStopsAfterDark: z.boolean(),
  comfortStopAfterMinutes: z.number().int().min(15).max(360).nullable(),
  viaWaypoints: z.array(z.string().trim().min(2).max(120)).max(3),
  routeObjective: z.object({
    label: z.string().trim().min(2).max(28),
    summary: z.string().trim().min(2).max(180),
    detourBudgetPercent: z.number().int().min(0).max(100),
    rankingCriteria: z.array(z.string().trim().min(2).max(80)).min(1).max(4),
    suggestedAnchors: z.array(z.object({
      query: z.string().trim().min(2).max(120),
      purpose: z.string().trim().min(2).max(120),
      insertAfterWaypointIndex: z.number().int().min(0).max(3),
      targetProgressPercent: z.number().int().min(5).max(95),
    })).max(3),
  }),
});

const routeBriefJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    avoidTolls: { type: "boolean" },
    avoidHighways: { type: "boolean" },
    avoidFerries: { type: "boolean" },
    fewerTransfers: { type: "boolean" },
    quietRide: { type: "boolean" },
    scenicRoute: { type: "boolean" },
    saferStopsAfterDark: { type: "boolean" },
    comfortStopAfterMinutes: { type: ["integer", "null"], minimum: 15, maximum: 360 },
    viaWaypoints: { type: "array", items: { type: "string", minLength: 2, maxLength: 120 }, maxItems: 3 },
    routeObjective: {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string", minLength: 2, maxLength: 28 },
        summary: { type: "string", minLength: 2, maxLength: 180 },
        detourBudgetPercent: { type: "integer", minimum: 0, maximum: 100 },
        rankingCriteria: { type: "array", items: { type: "string", minLength: 2, maxLength: 80 }, minItems: 1, maxItems: 4 },
        suggestedAnchors: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              query: { type: "string", minLength: 2, maxLength: 120 },
              purpose: { type: "string", minLength: 2, maxLength: 120 },
              insertAfterWaypointIndex: { type: "integer", minimum: 0, maximum: 3 },
              targetProgressPercent: { type: "integer", minimum: 5, maximum: 95 },
            },
            required: ["query", "purpose", "insertAfterWaypointIndex", "targetProgressPercent"],
          },
        },
      },
      required: ["label", "summary", "detourBudgetPercent", "rankingCriteria", "suggestedAnchors"],
    },
  },
  required: ["avoidTolls", "avoidHighways", "avoidFerries", "fewerTransfers", "quietRide", "scenicRoute", "saferStopsAfterDark", "comfortStopAfterMinutes", "viaWaypoints", "routeObjective"],
} as const;

const routeBriefSystemPrompt = "Act as a route-intent compiler, not a directions engine. Convert the traveler's brief into supported preferences plus a general routeObjective. Preserve only explicitly requested pass-through places in viaWaypoints, in travel order, using one concise place name per array item; never invent a hard waypoint. A phrase such as 'through Fremont' becomes ['Fremont'], while 'through Fremont and Santa Cruz' becomes ['Fremont', 'Santa Cruz']. routeObjective must capture any optional condition, not only scenic requests. Its label must be a short one-to-three-word option label such as Scenic, Quiet, Coffee-friendly, or Best match; do not include the destination in the label. rankingCriteria describe what later evidence should be judged against. suggestedAnchors are optional, soft Apple Maps search queries that could produce a meaningfully different candidate route; prefer a specific plausible corridor or place when the geography is familiar, otherwise use a searchable place category near the intended segment. They may name corridors, landmarks, parks, business categories, or public places not written verbatim by the traveler, but they are never treated as facts until Maps resolves them. Keep them geographically plausible for the supplied origin, destination, ordered hard waypoints, and travel mode. insertAfterWaypointIndex 0 means after the origin, 1 means after the first hard waypoint, and so on. targetProgressPercent indicates roughly where along the whole trip Maps should search. Use a conservative detour budget unless the traveler explicitly welcomes a longer route. Do not infer emergency actions, personal risk, or safety guarantees. saferStopsAfterDark is true only when the traveler asks for well-lit, populated, or less-isolated stops after dark. comfortStopAfterMinutes is null unless the traveler gives an approximate elapsed time for a coffee, rest, or comfort break.";

export async function interpretJourneyBrief(
  instructions: string | null | undefined,
  explicit: JourneyPreferences = {},
  context: JourneyBriefContext = { originLabel: "Current location", destinationLabel: "Destination", travelMode: "driving" },
): Promise<JourneyPreferences> {
  const deterministic = inferJourneyPreferences(instructions, explicit);
  const config = getConfig();
  if (config.AGENT_BRIEF_MODE === "deterministic" || !instructions?.trim()) return deterministic;
  const interpreted = config.AGENT_BRIEF_MODE === "openai"
    ? await interpretWithOpenAi(instructions.trim(), context)
    : await interpretWithOpenRouter(instructions.trim(), context);
  const groundedAiWaypoints = interpreted.viaWaypoints.filter((waypoint) => waypointWasRequested(instructions, waypoint));
  const hardWaypointCount = normalizeViaWaypoints([...(deterministic.viaWaypoints ?? []), ...groundedAiWaypoints]).length;
  const normalizedObjective = normalizeRouteObjective(interpreted.routeObjective, hardWaypointCount);
  const routeObjective = deterministic.scenicRoute || interpreted.scenicRoute
    ? {
      ...normalizedObjective,
      // A scenic candidate commonly needs a meaningful detour. Do not let a
      // generic "conservative" model budget silently eliminate every route
      // that contains the scenic evidence the model asked Maps to validate.
      detourBudgetPercent: Math.max(
        normalizedObjective.detourBudgetPercent,
        60,
      ),
    }
    : normalizedObjective;
  return inferJourneyPreferences(null, {
    avoidTolls: Boolean(deterministic.avoidTolls || interpreted.avoidTolls),
    avoidHighways: Boolean(deterministic.avoidHighways || interpreted.avoidHighways),
    avoidFerries: Boolean(deterministic.avoidFerries || interpreted.avoidFerries),
    fewerTransfers: Boolean(deterministic.fewerTransfers || interpreted.fewerTransfers),
    quietRide: Boolean(deterministic.quietRide || interpreted.quietRide),
    scenicRoute: Boolean(deterministic.scenicRoute || interpreted.scenicRoute),
    saferStopsAfterDark: Boolean(deterministic.saferStopsAfterDark || interpreted.saferStopsAfterDark),
    ...(deterministic.comfortStopAfterMinutes || interpreted.comfortStopAfterMinutes
      ? { comfortStopAfterMinutes: deterministic.comfortStopAfterMinutes ?? interpreted.comfortStopAfterMinutes ?? undefined }
      : {}),
    viaWaypoints: normalizeViaWaypoints([
      ...(deterministic.viaWaypoints ?? []),
      ...groundedAiWaypoints,
    ]),
    routeObjective,
  });
}

async function interpretWithOpenAi(instructions: string, context: JourneyBriefContext): Promise<z.infer<typeof interpretedSchema>> {
  const config = getConfig();
  if (!config.OPENAI_API_KEY || !config.OPENAI_MODEL) throw new Error("OpenAI route-brief configuration is incomplete.");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      instructions: routeBriefSystemPrompt,
      input: JSON.stringify({
        origin: context.originLabel,
        destination: context.destinationLabel,
        travelMode: context.travelMode,
        routeBrief: instructions,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "journey_preferences",
          strict: true,
          schema: routeBriefJsonSchema,
        },
      },
      store: false,
      max_output_tokens: 900,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message ?? `OpenAI failed with ${response.status}.`);
  const outputContent = payload.output?.flatMap((item) => item.content ?? []) ?? [];
  const content = payload.output_text ?? outputContent.find((item) => item.type === "output_text")?.text;
  const refusal = outputContent.find((item) => item.refusal)?.refusal;
  if (!content) throw new Error(refusal ? `OpenAI declined the route brief: ${refusal}` : "OpenAI returned an empty route-brief interpretation.");
  return interpretedSchema.parse(JSON.parse(content));
}

async function interpretWithOpenRouter(instructions: string, context: JourneyBriefContext): Promise<z.infer<typeof interpretedSchema>> {
  const config = getConfig();
  if (!config.OPENROUTER_API_KEY || !config.OPENROUTER_MODEL) throw new Error("OpenRouter route-brief configuration is incomplete.");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Turtle Maps route brief",
    },
    body: JSON.stringify({
      model: config.OPENROUTER_MODEL,
      messages: [
        { role: "system", content: routeBriefSystemPrompt },
        { role: "user", content: JSON.stringify({ origin: context.originLabel, destination: context.destinationLabel, travelMode: context.travelMode, routeBrief: instructions }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "journey_preferences",
          strict: true,
          schema: routeBriefJsonSchema,
        },
      },
      provider: { require_parameters: true },
      temperature: 0,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message ?? `OpenRouter failed with ${response.status}.`);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned an empty route-brief interpretation.");
  return interpretedSchema.parse(JSON.parse(content));
}

function normalizeRouteObjective(objective: z.infer<typeof interpretedSchema>["routeObjective"], hardWaypointCount: number): AgentRouteObjective {
  const seen = new Set<string>();
  const suggestedAnchors = objective.suggestedAnchors.flatMap((anchor) => {
    const query = anchor.query.trim().replace(/\s+/g, " ").slice(0, 120);
    const key = query.toLocaleLowerCase("en-US");
    if (query.length < 2 || seen.has(key)) return [];
    seen.add(key);
    return [{
      query,
      purpose: anchor.purpose.trim().replace(/\s+/g, " ").slice(0, 120),
      insertAfterWaypointIndex: Math.min(hardWaypointCount, anchor.insertAfterWaypointIndex),
      targetProgressPercent: anchor.targetProgressPercent,
    }];
  }).slice(0, 3);
  return {
    label: objective.label,
    summary: objective.summary,
    detourBudgetPercent: objective.detourBudgetPercent,
    rankingCriteria: objective.rankingCriteria,
    suggestedAnchors,
  };
}

function waypointWasRequested(instructions: string, waypoint: string): boolean {
  const normalize = (value: string) => value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const prompt = normalize(instructions);
  const fullWaypoint = normalize(waypoint);
  const primaryName = normalize(waypoint.split(",")[0] ?? waypoint);
  return [fullWaypoint, primaryName].some((candidate) => candidate.length >= 2 && prompt.includes(candidate));
}
