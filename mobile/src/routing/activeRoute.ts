import type { RouteAlternative, RouteCoordinate, RouteNavigationStep, ResolvedPlace } from "../../modules/turtle-map-search";
import type { Journey, SelectedRouteWaypoint } from "../types";

type ActiveRouteMapSearch = {
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

export async function rebuildActiveRoute(input: {
  mapSearch: ActiveRouteMapSearch;
  journey: Journey;
  origin: RouteCoordinate;
  destination: RouteCoordinate;
  resolvedWaypoints?: SelectedRouteWaypoint[];
}): Promise<{
  coordinates: RouteCoordinate[];
  waypoints: SelectedRouteWaypoint[];
  navigationSteps: RouteNavigationStep[];
  distanceMeters: number;
  durationSeconds: number;
}> {
  const { mapSearch, journey, origin, destination, resolvedWaypoints } = input;
  const bounds = routeBounds(origin, destination);
  const selectedLabels = journey.preferences.selectedRoute?.waypointLabels?.length
    ? journey.preferences.selectedRoute.waypointLabels
    : journey.preferences.viaWaypoints ?? [];
  const requiredLabels = journey.preferences.viaWaypoints ?? [];
  const waypoints: SelectedRouteWaypoint[] = resolvedWaypoints ? [...resolvedWaypoints] : [];
  if (!resolvedWaypoints) {
    for (const label of selectedLabels) {
      const place = await mapSearch.resolveRouteWaypoint(label, bounds.center.latitude, bounds.center.longitude, bounds.latitudeDelta, bounds.longitudeDelta);
      waypoints.push({
        label: place.label,
        latitude: place.latitude,
        longitude: place.longitude,
        role: requiredLabels.some((required) => normalizePlace(place.label).includes(normalizePlace(required))) ? "required" : "agent",
      });
    }
  }

  const stops = [origin, ...waypoints.map((waypoint) => ({ latitude: waypoint.latitude, longitude: waypoint.longitude })), destination];
  const routeNames = journey.preferences.selectedRoute?.routeNames ?? [];
  const selectedLegs: RouteAlternative[] = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const start = stops[index]!;
    const end = stops[index + 1]!;
    const alternatives = await mapSearch.calculateRouteAlternatives(
      start.latitude,
      start.longitude,
      end.latitude,
      end.longitude,
      journey.travelMode,
      journey.preferences.avoidTolls,
      journey.preferences.avoidHighways,
    );
    if (!alternatives.length) throw new Error("Apple Maps did not return the remaining route.");
    selectedLegs.push([...alternatives].sort((left, right) => alternativeScore(right, routeNames) - alternativeScore(left, routeNames)
      || left.expectedTravelTimeSeconds - right.expectedTravelTimeSeconds)[0]!);
  }

  return {
    coordinates: selectedLegs.flatMap((leg, index) => index === 0 ? leg.coordinates : leg.coordinates.slice(1)),
    waypoints,
    navigationSteps: selectedLegs.flatMap((leg) => leg.navigationSteps ?? []),
    distanceMeters: selectedLegs.reduce((total, leg) => total + leg.distanceMeters, 0),
    durationSeconds: selectedLegs.reduce((total, leg) => total + leg.expectedTravelTimeSeconds, 0),
  };
}

function alternativeScore(alternative: RouteAlternative, selectedRouteNames: string[]): number {
  const routeName = normalizePlace(alternative.routeName);
  return selectedRouteNames.some((selected) => routeName && normalizePlace(selected).includes(routeName)) ? 1 : 0;
}

function normalizePlace(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function routeBounds(origin: RouteCoordinate, destination: RouteCoordinate) {
  return {
    center: { latitude: (origin.latitude + destination.latitude) / 2, longitude: (origin.longitude + destination.longitude) / 2 },
    latitudeDelta: Math.max(Math.abs(origin.latitude - destination.latitude) * 1.7, 0.35),
    longitudeDelta: Math.max(Math.abs(origin.longitude - destination.longitude) * 1.7, 0.35),
  };
}
