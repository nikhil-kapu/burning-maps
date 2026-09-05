import type { RouteCoordinate } from "../../modules/turtle-map-search";
import type { SelectedRouteNavigationStep, SelectedRouteWaypoint } from "../types";

const precisionFactor = 100_000;
const maximumPersistedPoints = 2_400;

export function encodeRoutePolyline(coordinates: RouteCoordinate[]): string {
  let previousLatitude = 0;
  let previousLongitude = 0;
  let encoded = "";
  for (const coordinate of downsampleCoordinates(coordinates, maximumPersistedPoints)) {
    const latitude = Math.round(coordinate.latitude * precisionFactor);
    const longitude = Math.round(coordinate.longitude * precisionFactor);
    encoded += encodeValue(latitude - previousLatitude);
    encoded += encodeValue(longitude - previousLongitude);
    previousLatitude = latitude;
    previousLongitude = longitude;
  }
  return encoded;
}

export function decodeRoutePolyline(value: string | undefined): RouteCoordinate[] {
  if (!value) return [];
  const coordinates: RouteCoordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  try {
    while (index < value.length && coordinates.length <= maximumPersistedPoints) {
      const latitudeValue = decodeValue(value, index);
      index = latitudeValue.nextIndex;
      const longitudeValue = decodeValue(value, index);
      index = longitudeValue.nextIndex;
      latitude += latitudeValue.delta;
      longitude += longitudeValue.delta;
      const coordinate = { latitude: latitude / precisionFactor, longitude: longitude / precisionFactor };
      if (!isCoordinate(coordinate)) return [];
      coordinates.push(coordinate);
    }
  } catch {
    return [];
  }
  return coordinates.length >= 2 && coordinates.length <= maximumPersistedPoints ? coordinates : [];
}

export function routeProgress(input: {
  routeCoordinates: RouteCoordinate[];
  currentCoordinate?: RouteCoordinate;
  plannedDistanceMeters: number;
  plannedDurationSeconds: number;
  waypoints: SelectedRouteWaypoint[];
}): {
  progress: number;
  remainingDistanceMeters: number;
  remainingDurationSeconds: number;
  offRouteMeters: number | null;
  nextWaypoint?: SelectedRouteWaypoint;
  snappedCoordinate?: RouteCoordinate;
  traveledCoordinates: RouteCoordinate[];
  remainingCoordinates: RouteCoordinate[];
} {
  const { routeCoordinates, currentCoordinate, plannedDistanceMeters, plannedDurationSeconds, waypoints } = input;
  if (!currentCoordinate || routeCoordinates.length < 2) {
    return {
      progress: 0,
      remainingDistanceMeters: plannedDistanceMeters,
      remainingDurationSeconds: plannedDurationSeconds,
      offRouteMeters: null,
      nextWaypoint: waypoints[0],
      traveledCoordinates: [],
      remainingCoordinates: routeCoordinates,
    };
  }

  const geometry = routeNavigationGeometry(routeCoordinates, currentCoordinate);
  if (!geometry) {
    return {
      progress: 0,
      remainingDistanceMeters: plannedDistanceMeters,
      remainingDurationSeconds: plannedDurationSeconds,
      offRouteMeters: null,
      nextWaypoint: waypoints[0],
      traveledCoordinates: [],
      remainingCoordinates: routeCoordinates,
    };
  }

  if (geometry.offRouteMeters > 100_000) {
    return {
      progress: 0,
      remainingDistanceMeters: plannedDistanceMeters,
      remainingDurationSeconds: plannedDurationSeconds,
      offRouteMeters: geometry.offRouteMeters,
      nextWaypoint: waypoints[0],
      snappedCoordinate: geometry.snappedCoordinate,
      traveledCoordinates: [],
      remainingCoordinates: routeCoordinates,
    };
  }
  const waypointWithProgress = waypoints.map((waypoint) => ({
    waypoint,
    progressDistanceMeters: routeNavigationGeometry(routeCoordinates, { latitude: waypoint.latitude, longitude: waypoint.longitude })?.progressDistanceMeters ?? 0,
  }));
  return {
    progress: geometry.progress,
    remainingDistanceMeters: Math.max(0, plannedDistanceMeters * (1 - geometry.progress)),
    remainingDurationSeconds: Math.max(0, plannedDurationSeconds * (1 - geometry.progress)),
    offRouteMeters: geometry.offRouteMeters,
    nextWaypoint: waypointWithProgress.find((entry) => entry.progressDistanceMeters > geometry.progressDistanceMeters + 30)?.waypoint,
    snappedCoordinate: geometry.snappedCoordinate,
    traveledCoordinates: geometry.traveledCoordinates,
    remainingCoordinates: geometry.remainingCoordinates,
  };
}

export function navigationManeuver(input: {
  routeCoordinates: RouteCoordinate[];
  currentCoordinate?: RouteCoordinate;
  steps: SelectedRouteNavigationStep[];
}): {
  step: SelectedRouteNavigationStep;
  upcomingStep?: SelectedRouteNavigationStep;
  distanceToManeuverMeters: number;
} | undefined {
  const { routeCoordinates, currentCoordinate, steps } = input;
  if (!steps.length) return undefined;
  if (!currentCoordinate || routeCoordinates.length < 2) {
    return {
      step: steps[0]!,
      upcomingStep: steps[1],
      distanceToManeuverMeters: Math.max(0, steps[0]!.distanceMeters),
    };
  }

  const currentGeometry = routeNavigationGeometry(routeCoordinates, currentCoordinate);
  if (!currentGeometry) return undefined;
  const indexedSteps = steps.map((step) => ({
    step,
    progressDistanceMeters: routeNavigationGeometry(routeCoordinates, step.coordinate)?.progressDistanceMeters ?? 0,
  }));
  let activeIndex = indexedSteps.findIndex((entry) => entry.progressDistanceMeters >= currentGeometry.progressDistanceMeters - 15);
  if (activeIndex < 0) return undefined;
  const active = indexedSteps[activeIndex]!;
  return {
    step: active.step,
    upcomingStep: indexedSteps[activeIndex + 1]?.step,
    distanceToManeuverMeters: Math.max(0, active.progressDistanceMeters - currentGeometry.progressDistanceMeters),
  };
}

export type RouteNavigationGeometry = {
  progress: number;
  progressDistanceMeters: number;
  totalDistanceMeters: number;
  offRouteMeters: number;
  segmentIndex: number;
  snappedCoordinate: RouteCoordinate;
  routeBearing: number;
  traveledCoordinates: RouteCoordinate[];
  remainingCoordinates: RouteCoordinate[];
};

export function routeNavigationGeometry(routeCoordinates: RouteCoordinate[], currentCoordinate: RouteCoordinate): RouteNavigationGeometry | undefined {
  if (routeCoordinates.length < 2) return undefined;
  const cumulative = cumulativeDistances(routeCoordinates);
  let best: { segmentIndex: number; fraction: number; coordinate: RouteCoordinate; distance: number } | undefined;

  for (let segmentIndex = 0; segmentIndex < routeCoordinates.length - 1; segmentIndex += 1) {
    const start = routeCoordinates[segmentIndex]!;
    const end = routeCoordinates[segmentIndex + 1]!;
    const projection = projectOntoSegment(currentCoordinate, start, end);
    if (!best || projection.distance < best.distance) best = { segmentIndex, ...projection };
  }
  if (!best) return undefined;

  const segmentDistance = distanceMeters(routeCoordinates[best.segmentIndex]!, routeCoordinates[best.segmentIndex + 1]!);
  const progressDistanceMeters = (cumulative[best.segmentIndex] ?? 0) + segmentDistance * best.fraction;
  const totalDistanceMeters = cumulative.at(-1) ?? 0;
  const lookAheadCoordinate = coordinateAtDistance(routeCoordinates, cumulative, Math.min(totalDistanceMeters, progressDistanceMeters + 45));
  const routeBearing = bearingDegrees(best.coordinate, lookAheadCoordinate ?? routeCoordinates[best.segmentIndex + 1]!);
  const traveledCoordinates = [...routeCoordinates.slice(0, best.segmentIndex + 1), best.coordinate];
  const remainingCoordinates = [best.coordinate, ...routeCoordinates.slice(best.segmentIndex + 1)];

  return {
    progress: totalDistanceMeters > 0 ? Math.min(1, Math.max(0, progressDistanceMeters / totalDistanceMeters)) : 0,
    progressDistanceMeters,
    totalDistanceMeters,
    offRouteMeters: best.distance,
    segmentIndex: best.segmentIndex,
    snappedCoordinate: best.coordinate,
    routeBearing,
    traveledCoordinates,
    remainingCoordinates,
  };
}

export function destinationCoordinate(origin: RouteCoordinate, bearing: number, distance: number): RouteCoordinate {
  const radius = 6_371_000;
  const angularDistance = distance / radius;
  const heading = radians(bearing);
  const latitude = radians(origin.latitude);
  const longitude = radians(origin.longitude);
  const nextLatitude = Math.asin(Math.sin(latitude) * Math.cos(angularDistance)
    + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(heading));
  const nextLongitude = longitude + Math.atan2(
    Math.sin(heading) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(nextLatitude),
  );
  return { latitude: degrees(nextLatitude), longitude: degrees(nextLongitude) };
}

export function smoothBearing(previous: number | undefined, next: number, weight = 0.32): number {
  if (previous === undefined || !Number.isFinite(previous)) return normalizeBearing(next);
  const delta = ((normalizeBearing(next) - normalizeBearing(previous) + 540) % 360) - 180;
  return normalizeBearing(previous + delta * weight);
}

export function distanceMeters(left: RouteCoordinate, right: RouteCoordinate): number {
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const leftLatitude = radians(left.latitude);
  const rightLatitude = radians(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function projectOntoSegment(point: RouteCoordinate, start: RouteCoordinate, end: RouteCoordinate): { fraction: number; coordinate: RouteCoordinate; distance: number } {
  const latitudeScale = 111_320;
  const longitudeScale = latitudeScale * Math.cos(radians((start.latitude + end.latitude + point.latitude) / 3));
  const endX = (end.longitude - start.longitude) * longitudeScale;
  const endY = (end.latitude - start.latitude) * latitudeScale;
  const pointX = (point.longitude - start.longitude) * longitudeScale;
  const pointY = (point.latitude - start.latitude) * latitudeScale;
  const lengthSquared = endX * endX + endY * endY;
  const fraction = lengthSquared > 0 ? Math.min(1, Math.max(0, (pointX * endX + pointY * endY) / lengthSquared)) : 0;
  const coordinate = {
    latitude: start.latitude + (end.latitude - start.latitude) * fraction,
    longitude: start.longitude + (end.longitude - start.longitude) * fraction,
  };
  return { fraction, coordinate, distance: distanceMeters(point, coordinate) };
}

function coordinateAtDistance(coordinates: RouteCoordinate[], cumulative: number[], targetDistance: number): RouteCoordinate | undefined {
  const segmentEndIndex = cumulative.findIndex((distance) => distance >= targetDistance);
  if (segmentEndIndex <= 0) return coordinates[0];
  if (segmentEndIndex < 0) return coordinates.at(-1);
  const start = coordinates[segmentEndIndex - 1]!;
  const end = coordinates[segmentEndIndex]!;
  const startDistance = cumulative[segmentEndIndex - 1] ?? 0;
  const segmentDistance = (cumulative[segmentEndIndex] ?? startDistance) - startDistance;
  const fraction = segmentDistance > 0 ? Math.min(1, Math.max(0, (targetDistance - startDistance) / segmentDistance)) : 0;
  return {
    latitude: start.latitude + (end.latitude - start.latitude) * fraction,
    longitude: start.longitude + (end.longitude - start.longitude) * fraction,
  };
}

function bearingDegrees(start: RouteCoordinate, end: RouteCoordinate): number {
  const startLatitude = radians(start.latitude);
  const endLatitude = radians(end.latitude);
  const longitudeDelta = radians(end.longitude - start.longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(endLatitude);
  const x = Math.cos(startLatitude) * Math.sin(endLatitude)
    - Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(longitudeDelta);
  return normalizeBearing(degrees(Math.atan2(y, x)));
}

function normalizeBearing(value: number): number {
  return (value % 360 + 360) % 360;
}

function radians(value: number): number {
  return value * Math.PI / 180;
}

function degrees(value: number): number {
  return value * 180 / Math.PI;
}

function cumulativeDistances(coordinates: RouteCoordinate[]): number[] {
  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative.push((cumulative[index - 1] ?? 0) + distanceMeters(coordinates[index - 1]!, coordinates[index]!));
  }
  return cumulative;
}

function nearestCoordinateIndex(coordinates: RouteCoordinate[], target: RouteCoordinate): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  coordinates.forEach((coordinate, index) => {
    const distance = distanceMeters(target, coordinate);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function downsampleCoordinates(coordinates: RouteCoordinate[], maximumPoints: number): RouteCoordinate[] {
  if (coordinates.length <= maximumPoints) return coordinates;
  return Array.from({ length: maximumPoints }, (_, index) => coordinates[Math.round(index * (coordinates.length - 1) / (maximumPoints - 1))]!);
}

function decodeValue(value: string, startIndex: number): { delta: number; nextIndex: number } {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  while (index < value.length) {
    const byte = value.charCodeAt(index) - 63;
    if (byte < 0 || byte > 63) throw new Error("Malformed polyline");
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
    if (byte < 0x20) return { delta: (result & 1) ? ~(result >> 1) : result >> 1, nextIndex: index };
    if (shift > 30) throw new Error("Malformed polyline");
  }
  throw new Error("Incomplete polyline");
}

function encodeValue(value: number): string {
  let shifted = value < 0 ? ~(value << 1) : value << 1;
  let encoded = "";
  while (shifted >= 0x20) {
    encoded += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
    shifted >>= 5;
  }
  return encoded + String.fromCharCode(shifted + 63);
}

function isCoordinate(value: RouteCoordinate): boolean {
  return Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
    && value.latitude >= -90 && value.latitude <= 90
    && value.longitude >= -180 && value.longitude <= 180;
}
