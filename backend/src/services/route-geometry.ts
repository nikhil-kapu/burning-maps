export type RouteGeometryCoordinate = {
  latitude: number;
  longitude: number;
};

const precisionFactor = 100_000;

export function decodeRoutePolyline(value: string, maximumPoints = 3_000): RouteGeometryCoordinate[] {
  if (!value || value.length > 96_000) throw new Error("Route geometry is empty or too large.");
  const coordinates: RouteGeometryCoordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < value.length) {
    const latitudeValue = decodeValue(value, index);
    index = latitudeValue.nextIndex;
    const longitudeValue = decodeValue(value, index);
    index = longitudeValue.nextIndex;
    latitude += latitudeValue.delta;
    longitude += longitudeValue.delta;
    const coordinate = { latitude: latitude / precisionFactor, longitude: longitude / precisionFactor };
    if (!Number.isFinite(coordinate.latitude) || !Number.isFinite(coordinate.longitude)
      || coordinate.latitude < -90 || coordinate.latitude > 90
      || coordinate.longitude < -180 || coordinate.longitude > 180) {
      throw new Error("Route geometry contains an invalid coordinate.");
    }
    coordinates.push(coordinate);
    if (coordinates.length > maximumPoints) throw new Error("Route geometry contains too many points.");
  }

  if (coordinates.length < 2) throw new Error("Route geometry must contain at least two points.");
  return coordinates;
}

export function encodeRoutePolyline(coordinates: RouteGeometryCoordinate[]): string {
  let previousLatitude = 0;
  let previousLongitude = 0;
  let encoded = "";
  for (const coordinate of coordinates) {
    const latitude = Math.round(coordinate.latitude * precisionFactor);
    const longitude = Math.round(coordinate.longitude * precisionFactor);
    encoded += encodeValue(latitude - previousLatitude);
    encoded += encodeValue(longitude - previousLongitude);
    previousLatitude = latitude;
    previousLongitude = longitude;
  }
  return encoded;
}

export function distanceMeters(left: RouteGeometryCoordinate, right: RouteGeometryCoordinate): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const leftLatitude = radians(left.latitude);
  const rightLatitude = radians(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function decodeValue(value: string, startIndex: number): { delta: number; nextIndex: number } {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  while (index < value.length) {
    const byte = value.charCodeAt(index) - 63;
    if (byte < 0 || byte > 63) throw new Error("Route geometry is malformed.");
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
    if (byte < 0x20) return { delta: (result & 1) ? ~(result >> 1) : result >> 1, nextIndex: index };
    if (shift > 30) throw new Error("Route geometry is malformed.");
  }
  throw new Error("Route geometry is incomplete.");
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
