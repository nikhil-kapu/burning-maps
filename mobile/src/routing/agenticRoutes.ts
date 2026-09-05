import type { ResolvedPlace, RouteAlternative, RouteCoordinate, RouteNavigationStep } from "../../modules/turtle-map-search";
import type { Journey, RouteCandidateEvidence, RouteCandidateRanking } from "../types";

export type ResolvedRouteWaypoint = {
  requestedLabel: string;
  place: ResolvedPlace;
  coordinate: RouteCoordinate;
  role: "required" | "agent";
  purpose?: string;
  insertAfterWaypointIndex: number;
};

export type JourneyRouteCandidate = {
  id: string;
  profile: RouteCandidateEvidence["profile"];
  coordinates: RouteCoordinate[];
  distanceMeters: number;
  expectedTravelTimeSeconds: number;
  routeNames: string[];
  advisoryNotices: string[];
  stepInstructions: string[];
  navigationSteps: RouteNavigationStep[];
  origin: RouteCoordinate;
  waypoints: ResolvedRouteWaypoint[];
};

export type PresentedRouteOption = {
  candidate: JourneyRouteCandidate;
  label: string;
  rationale: string;
  matchScore: number;
  recommended: boolean;
  alsoQuickest: boolean;
  alsoShortest: boolean;
};

type MapSearchApi = {
  resolveRouteWaypoint(query: string, centerLatitude: number, centerLongitude: number, latitudeDelta: number, longitudeDelta: number): Promise<ResolvedPlace>;
  calculateRouteAlternatives(
    originLatitude: number,
    originLongitude: number,
    destinationLatitude: number,
    destinationLongitude: number,
    travelMode: string,
    avoidTolls: boolean,
    avoidHighways: boolean,
  ): Promise<RouteAlternative[]>;
};

export async function buildAgenticRouteCandidates(input: {
  mapSearch: MapSearchApi;
  journey: Journey;
  origin: RouteCoordinate;
  destination: RouteCoordinate;
  onStage?: (stage: string) => void;
}): Promise<{ candidates: JourneyRouteCandidate[]; requiredWaypoints: ResolvedRouteWaypoint[]; validatedAgentAnchors: ResolvedRouteWaypoint[] }> {
  const { mapSearch, journey, origin, destination, onStage } = input;
  const bounds = routeBounds(origin, destination);
  onStage?.("Placing required stops…");
  const requiredWaypoints: ResolvedRouteWaypoint[] = [];
  const requiredWaypointLabels = normalizeRequiredWaypointLabels(journey.preferences.viaWaypoints ?? []);
  for (const [index, requestedLabel] of requiredWaypointLabels.entries()) {
    const place = await mapSearch.resolveRouteWaypoint(requestedLabel, bounds.center.latitude, bounds.center.longitude, bounds.latitudeDelta, bounds.longitudeDelta);
    requiredWaypoints.push({
      requestedLabel,
      place,
      coordinate: { latitude: place.latitude, longitude: place.longitude },
      role: "required",
      insertAfterWaypointIndex: index,
    });
  }

  const requiredStops = [origin, ...requiredWaypoints.map((waypoint) => waypoint.coordinate), destination];
  const explicitlyAvoidsHighways = /\bavoid(?:ing)?\s+(?:the\s+)?(?:highways?|freeways?)\b/i.test(journey.agentInstructions ?? "");
  const baseAvoidHighways = explicitlyAvoidsHighways && Boolean(journey.preferences.avoidHighways);
  onStage?.("Comparing Apple Maps routes…");
  const baseLegs = await calculateLegAlternatives(mapSearch, journey, requiredStops, Boolean(journey.preferences.avoidTolls), baseAvoidHighways);
  const candidates: JourneyRouteCandidate[] = [];
  addUniqueCandidate(candidates, composeCandidate("standard-quick", "standard", baseLegs, requiredWaypoints, origin, "quickest"));
  addUniqueCandidate(candidates, composeCandidate("standard-short", "standard", baseLegs, requiredWaypoints, origin, "shortest"));
  addUniqueCandidate(candidates, composeCandidate("standard-alt-1", "standard", baseLegs, requiredWaypoints, origin, 1));
  addUniqueCandidate(candidates, composeCandidate("standard-alt-2", "standard", baseLegs, requiredWaypoints, origin, 2));

  const preferenceAvoidHighways = Boolean(journey.preferences.avoidHighways || journey.preferences.scenicRoute);
  if (preferenceAvoidHighways !== baseAvoidHighways) {
    const preferenceLegs = await calculateLegAlternatives(mapSearch, journey, requiredStops, Boolean(journey.preferences.avoidTolls), preferenceAvoidHighways);
    addUniqueCandidate(candidates, composeCandidate("preference-quick", "preference", preferenceLegs, requiredWaypoints, origin, "quickest"));
    addUniqueCandidate(candidates, composeCandidate("preference-short", "preference", preferenceLegs, requiredWaypoints, origin, "shortest"));
    addUniqueCandidate(candidates, composeCandidate("preference-alt", "preference", preferenceLegs, requiredWaypoints, origin, 1));
  }

  const baseline = [...candidates].sort((left, right) => left.expectedTravelTimeSeconds - right.expectedTravelTimeSeconds)[0];
  const objective = journey.preferences.routeObjective;
  const validatedAgentAnchors: ResolvedRouteWaypoint[] = [];
  if (baseline && objective?.suggestedAnchors.length) {
    onStage?.("Validating agent ideas with Maps…");
    for (const suggestion of objective.suggestedAnchors.slice(0, 3)) {
      const insertionIndex = Math.min(requiredWaypoints.length, suggestion.insertAfterWaypointIndex);
      const segmentStart = insertionIndex === 0 ? origin : requiredWaypoints[insertionIndex - 1]!.coordinate;
      const segmentEnd = insertionIndex === requiredWaypoints.length ? destination : requiredWaypoints[insertionIndex]!.coordinate;
      const segmentCenter = midpoint(segmentStart, segmentEnd);
      const progressCenter = coordinateAtProgress(baseline.coordinates, suggestion.targetProgressPercent);
      const searchCenter = {
        latitude: segmentCenter.latitude * 0.75 + progressCenter.latitude * 0.25,
        longitude: segmentCenter.longitude * 0.75 + progressCenter.longitude * 0.25,
      };
      try {
        const place = await mapSearch.resolveRouteWaypoint(
          suggestion.query,
          searchCenter.latitude,
          searchCenter.longitude,
          Math.max(0.18, bounds.latitudeDelta * 0.42),
          Math.max(0.18, bounds.longitudeDelta * 0.42),
        );
        validatedAgentAnchors.push({
          requestedLabel: suggestion.query,
          place,
          coordinate: { latitude: place.latitude, longitude: place.longitude },
          role: "agent",
          purpose: suggestion.purpose,
          insertAfterWaypointIndex: insertionIndex,
        });
      } catch {
        // Soft agent ideas never block the required route. Unresolved places are omitted from evidence.
      }
    }
  }

  if (validatedAgentAnchors.length) {
    onStage?.("Testing agent route candidates…");
    const anchorSets = [
      ...validatedAgentAnchors.slice(0, 2).map((anchor) => [anchor]),
      ...(validatedAgentAnchors.length > 1 ? [validatedAgentAnchors] : []),
    ];
    for (const [index, anchors] of anchorSets.entries()) {
      const orderedWaypoints = orderWaypoints(requiredWaypoints, anchors);
      const stops = [origin, ...orderedWaypoints.map((waypoint) => waypoint.coordinate), destination];
      try {
        const legs = await calculateLegAlternatives(mapSearch, journey, stops, Boolean(journey.preferences.avoidTolls), preferenceAvoidHighways);
        addUniqueCandidate(candidates, composeCandidate(`agent-${index}-quick`, "agent_anchor", legs, orderedWaypoints, origin, "quickest"));
        addUniqueCandidate(candidates, composeCandidate(`agent-${index}-short`, "agent_anchor", legs, orderedWaypoints, origin, "shortest"));
      } catch {
        // A failed soft-anchor strategy is discarded; required-place candidates remain available.
      }
      if (candidates.length >= 10) break;
    }
  }

  return { candidates: candidates.slice(0, 10), requiredWaypoints, validatedAgentAnchors };
}

export function normalizeRequiredWaypointLabels(values: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values.flatMap(splitCoordinatedWaypointNames)) {
    const waypoint = value.trim().replace(/\s+/g, " ").slice(0, 120);
    const key = waypoint.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
    if (waypoint.length < 2 || seen.has(key)) continue;
    seen.add(key);
    normalized.push(waypoint);
    if (normalized.length === 3) break;
  }
  return normalized;
}

function splitCoordinatedWaypointNames(value: string): string[] {
  const waypoint = value.trim().replace(/\s+/g, " ");
  const parts = waypoint.split(/\s+(?:and|then)\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => part.length < 2)) return [waypoint];
  return parts;
}

export function candidateEvidence(candidate: JourneyRouteCandidate): RouteCandidateEvidence {
  return {
    candidateId: candidate.id,
    profile: candidate.profile,
    durationSeconds: Math.round(candidate.expectedTravelTimeSeconds),
    distanceMeters: candidate.distanceMeters,
    routeNames: candidate.routeNames,
    advisoryNotices: candidate.advisoryNotices,
    stepInstructions: candidate.stepInstructions.slice(0, 80),
    anchorEvidence: candidate.waypoints
      .filter((waypoint) => waypoint.role === "agent" && waypoint.purpose)
      .map((waypoint) => ({ label: waypoint.place.label, purpose: waypoint.purpose! })),
  };
}

export function presentRouteOptions(
  candidates: JourneyRouteCandidate[],
  ranking: RouteCandidateRanking,
  objectiveLabel: string,
): PresentedRouteOption[] {
  const fastest = [...candidates].sort((left, right) => left.expectedTravelTimeSeconds - right.expectedTravelTimeSeconds)[0]!;
  const shortest = [...candidates].sort((left, right) => left.distanceMeters - right.distanceMeters)[0]!;
  const evaluationById = new Map(ranking.evaluations.map((evaluation) => [evaluation.candidateId, evaluation]));
  const recommended = candidates.find((candidate) => candidate.id === ranking.recommendedCandidateId) ?? fastest;
  const selected: JourneyRouteCandidate[] = [];
  for (const candidate of [recommended, fastest, shortest, ...[...candidates].sort((left, right) => (evaluationById.get(right.id)?.matchScore ?? 0) - (evaluationById.get(left.id)?.matchScore ?? 0))]) {
    if (!selected.some((value) => value.id === candidate.id)) selected.push(candidate);
    if (selected.length === 3) break;
  }

  return selected.map((candidate, index) => {
    const isRecommended = candidate.id === recommended.id;
    const isFastest = candidate.id === fastest.id;
    const isShortest = candidate.id === shortest.id;
    const evaluation = evaluationById.get(candidate.id);
    const hasConfidentObjectiveMatch = (evaluation?.matchScore ?? 0) >= 60;
    let label: string;
    if (isRecommended && !hasConfidentObjectiveMatch) label = "Best available";
    else if (isRecommended) label = objectiveLabel.toLocaleLowerCase("en-US") === "best match" ? "Best match" : `${objectiveLabel} pick`;
    else if (isFastest && isShortest) label = "Quickest & shortest";
    else if (isFastest) label = "Quickest";
    else if (isShortest) label = "Shortest";
    else label = index === 1 ? "Balanced" : "Alternative";
    return {
      candidate,
      label,
      rationale: evaluation?.rationale ?? defaultRationale(label, candidate),
      matchScore: evaluation?.matchScore ?? 0,
      recommended: isRecommended,
      alsoQuickest: isFastest,
      alsoShortest: isShortest,
    };
  });
}

async function calculateLegAlternatives(
  mapSearch: MapSearchApi,
  journey: Journey,
  stops: RouteCoordinate[],
  avoidTolls: boolean,
  avoidHighways: boolean,
): Promise<RouteAlternative[][]> {
  const legs: RouteAlternative[][] = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const from = stops[index]!;
    const to = stops[index + 1]!;
    const alternatives = await mapSearch.calculateRouteAlternatives(
      from.latitude,
      from.longitude,
      to.latitude,
      to.longitude,
      journey.travelMode,
      avoidTolls,
      avoidHighways,
    );
    if (!alternatives.length) throw new Error("Apple Maps did not return a route for one of the required legs.");
    legs.push(alternatives);
  }
  return legs;
}

function composeCandidate(
  id: string,
  profile: JourneyRouteCandidate["profile"],
  legs: RouteAlternative[][],
  waypoints: ResolvedRouteWaypoint[],
  origin: RouteCoordinate,
  selector: "quickest" | "shortest" | number,
): JourneyRouteCandidate {
  const selectedLegs = legs.map((alternatives) => {
    if (selector === "quickest") return [...alternatives].sort((left, right) => left.expectedTravelTimeSeconds - right.expectedTravelTimeSeconds)[0]!;
    if (selector === "shortest") return [...alternatives].sort((left, right) => left.distanceMeters - right.distanceMeters)[0]!;
    return alternatives[Math.min(selector, alternatives.length - 1)]!;
  });
  const coordinates = selectedLegs.flatMap((leg, index) => index === 0 ? leg.coordinates : leg.coordinates.slice(1));
  return {
    id,
    profile,
    coordinates,
    distanceMeters: selectedLegs.reduce((sum, leg) => sum + leg.distanceMeters, 0),
    expectedTravelTimeSeconds: selectedLegs.reduce((sum, leg) => sum + leg.expectedTravelTimeSeconds, 0),
    routeNames: uniqueStrings(selectedLegs.map((leg) => leg.routeName).filter(Boolean)),
    advisoryNotices: uniqueStrings(selectedLegs.flatMap((leg) => leg.advisoryNotices)),
    stepInstructions: selectedLegs.flatMap((leg) => leg.stepInstructions).map((value) => value.trim()).filter(Boolean),
    navigationSteps: selectedLegs.flatMap((leg) => leg.navigationSteps ?? []),
    origin,
    waypoints,
  };
}

function addUniqueCandidate(candidates: JourneyRouteCandidate[], candidate: JourneyRouteCandidate): void {
  const signature = routeSignature(candidate);
  if (!candidates.some((existing) => routeSignature(existing) === signature)) candidates.push(candidate);
}

function routeSignature(candidate: JourneyRouteCandidate): string {
  const coordinateIndexes = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.min(candidate.coordinates.length - 1, Math.round((candidate.coordinates.length - 1) * fraction)));
  return coordinateIndexes.map((index) => {
    const coordinate = candidate.coordinates[index]!;
    return `${coordinate.latitude.toFixed(3)},${coordinate.longitude.toFixed(3)}`;
  }).join("|");
}

function orderWaypoints(required: ResolvedRouteWaypoint[], anchors: ResolvedRouteWaypoint[]): ResolvedRouteWaypoint[] {
  const ordered: ResolvedRouteWaypoint[] = [];
  for (let segment = 0; segment <= required.length; segment += 1) {
    ordered.push(...anchors.filter((anchor) => anchor.insertAfterWaypointIndex === segment));
    if (required[segment]) ordered.push(required[segment]!);
  }
  return ordered;
}

function coordinateAtProgress(coordinates: RouteCoordinate[], progressPercent: number): RouteCoordinate {
  return coordinates[Math.min(coordinates.length - 1, Math.max(0, Math.round((coordinates.length - 1) * progressPercent / 100)))]!;
}

function midpoint(left: RouteCoordinate, right: RouteCoordinate): RouteCoordinate {
  return { latitude: (left.latitude + right.latitude) / 2, longitude: (left.longitude + right.longitude) / 2 };
}

function routeBounds(origin: RouteCoordinate, destination: RouteCoordinate) {
  return {
    center: { latitude: (origin.latitude + destination.latitude) / 2, longitude: (origin.longitude + destination.longitude) / 2 },
    latitudeDelta: Math.max(Math.abs(origin.latitude - destination.latitude) * 1.7, 0.35),
    longitudeDelta: Math.max(Math.abs(origin.longitude - destination.longitude) * 1.7, 0.35),
  };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLocaleLowerCase("en-US");
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function defaultRationale(label: string, candidate: JourneyRouteCandidate): string {
  if (label.includes("Quickest")) return "Fastest Apple Maps option that keeps every required place.";
  if (label === "Shortest") return "Lowest-distance Apple Maps option that keeps every required place.";
  if (candidate.waypoints.some((waypoint) => waypoint.role === "agent")) return "Uses a Maps-validated place proposed from your route brief.";
  return "A distinct legal alternative through all required places.";
}
