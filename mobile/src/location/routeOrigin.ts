import * as Location from "expo-location";

export type RouteOriginSource = "recent" | "fresh" | "last_known" | "simulator_demo";

export type ResolvedRouteOrigin = {
  coordinate: { latitude: number; longitude: number };
  source: RouteOriginSource;
};

export class RouteOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteOriginError";
  }
}

const simulatorDemoOrigin = { latitude: 37.7749, longitude: -122.4194 };

export async function resolveCurrentRouteOrigin(): Promise<ResolvedRouteOrigin> {
  let permission: Location.LocationPermissionResponse;
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    permission = existing.granted ? existing : await Location.requestForegroundPermissionsAsync();
  } catch {
    throw new RouteOriginError("Turtle Maps could not check location access. Open iOS Settings, allow location access, and try again.");
  }

  if (!permission.granted) {
    throw new RouteOriginError("Allow location access to build the route from where you are. You can change this in iOS Settings and then try again.");
  }

  const recent = await Location.getLastKnownPositionAsync({
    maxAge: 2 * 60_000,
    requiredAccuracy: 1_000,
  }).catch(() => null);
  if (recent) return { coordinate: coordinateFrom(recent), source: "recent" };

  const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => true);
  if (servicesEnabled) {
    try {
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { coordinate: coordinateFrom(current), source: "fresh" };
    } catch {
      // A last-known position or development-only demo origin can still build a useful preview.
    }
  }

  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: 24 * 60 * 60_000,
    requiredAccuracy: 10_000,
  }).catch(() => null);
  if (lastKnown) return { coordinate: coordinateFrom(lastKnown), source: "last_known" };

  if (__DEV__) return { coordinate: simulatorDemoOrigin, source: "simulator_demo" };

  throw new RouteOriginError(
    servicesEnabled
      ? "Turtle Maps could not get your starting location. Move somewhere with a clearer GPS signal and try again."
      : "Location Services are off. Turn them on in iOS Settings to build a route from your current position.",
  );
}

function coordinateFrom(location: Location.LocationObject) {
  return { latitude: location.coords.latitude, longitude: location.coords.longitude };
}
