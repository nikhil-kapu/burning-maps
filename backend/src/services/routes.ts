import { getConfig } from "../config.js";

export type TravelMode = "driving" | "public_transit" | "bus" | "subway" | "train" | "taxi" | "rideshare" | "walking" | "cycling";

export type RouteAnchorSuggestion = {
  query: string;
  purpose: string;
  insertAfterWaypointIndex: number;
  targetProgressPercent: number;
};

export type AgentRouteObjective = {
  label: string;
  summary: string;
  detourBudgetPercent: number;
  rankingCriteria: string[];
  suggestedAnchors: RouteAnchorSuggestion[];
};

export type SelectedJourneyRoute = {
  candidateId: string;
  label: string;
  rationale: string;
  durationSeconds: number;
  distanceMeters: number;
  waypointLabels: string[];
  routeNames: string[];
  routePolyline?: string;
  routeWaypoints?: Array<{
    label: string;
    latitude: number;
    longitude: number;
    role: "required" | "agent";
    purpose?: string;
  }>;
  navigationSteps?: Array<{
    instruction: string;
    distanceMeters: number;
    coordinate: { latitude: number; longitude: number };
  }>;
};

export type JourneyPreferences = {
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
  fewerTransfers?: boolean;
  quietRide?: boolean;
  scenicRoute?: boolean;
  saferStopsAfterDark?: boolean;
  comfortStopAfterMinutes?: number;
  viaWaypoints?: string[];
  routeObjective?: AgentRouteObjective;
  selectedRoute?: SelectedJourneyRoute;
};

export type RouteSnapshot = {
  durationSeconds: number;
  distanceMeters: number;
  warnings: string[];
};

const drivingModes = new Set<TravelMode>(["driving", "taxi", "rideshare"]);
const transitModes = new Set<TravelMode>(["public_transit", "bus", "subway", "train"]);

export function inferJourneyPreferences(
  instructions: string | null | undefined,
  explicit: JourneyPreferences = {},
): JourneyPreferences {
  const originalText = instructions?.replace(/[–—]/g, "-") ?? "";
  const text = originalText.toLowerCase();
  const scenicRoute = Boolean(explicit.scenicRoute || /\b(scenic|back roads?|calm route)\b/.test(text));
  const saferStopsAfterDark = Boolean(
    explicit.saferStopsAfterDark
    || (/\b(after dark|at night|nighttime)\b/.test(text) && /\b(safe|safer|well[- ]lit|populated|isolated)\b/.test(text)),
  );
  const stopTiming = text.match(/\b(?:after|around|in)\s+(\d{1,3})\s*(?:minutes?|mins?)\b/);
  const requestedStop = /\b(coffee|cafe|break|rest stop|comfort stop)\b/.test(text);
  const inferredStopMinutes = requestedStop && stopTiming
    ? Math.min(360, Math.max(15, Number(stopTiming[1])))
    : undefined;
  const viaWaypoints = normalizeViaWaypoints([
    ...(explicit.viaWaypoints ?? []),
    ...extractViaWaypoints(originalText),
  ]);
  const routeObjective = explicit.routeObjective ?? (originalText.trim() ? {
    label: scenicRoute ? "Scenic" : requestedStop ? "Comfort" : saferStopsAfterDark ? "After-dark" : "Best match",
    summary: originalText.trim().slice(0, 160),
    detourBudgetPercent: scenicRoute ? 60 : 35,
    rankingCriteria: scenicRoute
      ? ["scenic character", "reasonable detour", "required places"]
      : ["traveler request", "reasonable detour", "required places"],
    suggestedAnchors: [],
  } satisfies AgentRouteObjective : undefined);

  return {
    avoidTolls: Boolean(explicit.avoidTolls || /\bavoid(?:ing)?\s+(?:the\s+)?tolls?\b/.test(text)),
    avoidHighways: Boolean(explicit.avoidHighways || scenicRoute || /\bavoid(?:ing)?\s+(?:the\s+)?(?:highways?|freeways?)\b/.test(text)),
    avoidFerries: Boolean(explicit.avoidFerries || /\bavoid(?:ing)?\s+(?:the\s+)?ferr(?:y|ies)\b/.test(text)),
    fewerTransfers: Boolean(explicit.fewerTransfers || /\b(fewer|minimi[sz]e|avoid)\s+transfers?\b/.test(text)),
    quietRide: Boolean(explicit.quietRide || /\b(quiet ride|minimal updates?|only (?:call|alert|tell|notify))\b/.test(text)),
    scenicRoute,
    saferStopsAfterDark,
    ...(explicit.comfortStopAfterMinutes || inferredStopMinutes
      ? { comfortStopAfterMinutes: explicit.comfortStopAfterMinutes ?? inferredStopMinutes }
      : {}),
    ...(viaWaypoints.length ? { viaWaypoints } : {}),
    ...(routeObjective ? { routeObjective } : {}),
    ...(explicit.selectedRoute ? { selectedRoute: explicit.selectedRoute } : {}),
  };
}

function extractViaWaypoints(instructions: string): string[] {
  const matches = instructions.matchAll(/\b(?:via|through|by\s+way\s+of)\s+([^,.;]+)/gi);
  return Array.from(matches, (match) => match[1] ?? "")
    .map((value) => value
      .replace(/\s+(?:and\s+)?(?:avoid(?:ing)?|prefer(?:ring)?|without|with|while|using|take|keep|remind|notify|call|alert|suggest)\b.*$/i, "")
      .trim());
}

export function normalizeViaWaypoints(values: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values.flatMap(splitCoordinatedWaypointNames)) {
    const waypoint = value.trim().replace(/\s+/g, " ").slice(0, 120);
    const key = normalizeWaypointName(waypoint);
    if (waypoint.length < 2 || seen.has(key)) continue;
    seen.add(key);
    normalized.push(waypoint);
    if (normalized.length === 3) break;
  }
  return normalized;
}

export function missingRequiredWaypoints(requiredWaypoints: string[], selectedWaypointLabels: string[]): string[] {
  const selected = selectedWaypointLabels.map(normalizeWaypointName).filter(Boolean);
  return normalizeViaWaypoints(requiredWaypoints).filter((requiredWaypoint) => {
    const required = normalizeWaypointName(requiredWaypoint);
    return !selected.some((label) => label.includes(required));
  });
}

function splitCoordinatedWaypointNames(value: string): string[] {
  const waypoint = value.trim().replace(/\s+/g, " ");
  const parts = waypoint.split(/\s+(?:and|then)\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => part.length < 2)) return [waypoint];
  return parts;
}

function normalizeWaypointName(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function googleTravelMode(mode: TravelMode): "DRIVE" | "TRANSIT" | "WALK" | "BICYCLE" {
  if (drivingModes.has(mode)) return "DRIVE";
  if (transitModes.has(mode)) return "TRANSIT";
  return mode === "walking" ? "WALK" : "BICYCLE";
}

function parseDuration(value: string | undefined): number {
  const match = value?.match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) throw new Error("Google Routes returned an invalid duration.");
  return Math.round(Number(match[1]));
}

export async function getRouteSnapshot(input: {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  travelMode: TravelMode;
  preferences: JourneyPreferences;
}): Promise<RouteSnapshot | null> {
  const config = getConfig();
  if (config.ROUTE_UPDATES_MODE === "disabled") return null;
  if (!config.GOOGLE_ROUTES_API_KEY) throw new Error("Google Routes configuration is incomplete.");

  const travelMode = googleTravelMode(input.travelMode);
  const body: Record<string, unknown> = {
    origin: { location: { latLng: input.origin } },
    destination: { location: { latLng: input.destination } },
    travelMode,
    languageCode: "en-US",
    units: "IMPERIAL",
  };
  const viaWaypoints = normalizeViaWaypoints(input.preferences.selectedRoute?.waypointLabels ?? input.preferences.viaWaypoints ?? []);
  if (viaWaypoints.length) {
    body.intermediates = viaWaypoints.map((address) => ({ address, via: true }));
  }
  if (travelMode === "DRIVE") {
    body.routingPreference = "TRAFFIC_AWARE";
    body.routeModifiers = {
      avoidTolls: Boolean(input.preferences.avoidTolls),
      avoidHighways: Boolean(input.preferences.avoidHighways),
      avoidFerries: Boolean(input.preferences.avoidFerries),
    };
  }
  if (travelMode === "TRANSIT") {
    const allowedTravelModes = input.travelMode === "bus" ? ["BUS"] : input.travelMode === "subway" ? ["SUBWAY"] : input.travelMode === "train" ? ["TRAIN", "RAIL"] : undefined;
    body.transitPreferences = {
      ...(allowedTravelModes ? { allowedTravelModes } : {}),
      ...(input.preferences.fewerTransfers ? { routingPreference: "FEWER_TRANSFERS" } : {}),
    };
  }

  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": config.GOOGLE_ROUTES_API_KEY,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.warnings",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    routes?: Array<{ duration?: string; distanceMeters?: number; warnings?: string[] }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message ?? `Google Routes failed with ${response.status}.`);
  const route = payload.routes?.[0];
  if (!route?.duration || typeof route.distanceMeters !== "number") throw new Error("Google Routes did not return a route.");
  return { durationSeconds: parseDuration(route.duration), distanceMeters: route.distanceMeters, warnings: route.warnings ?? [] };
}
