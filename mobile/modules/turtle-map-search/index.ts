import { NativeModule, requireOptionalNativeModule } from "expo";

export type PlaceSuggestion = {
  id: string;
  title: string;
  subtitle: string;
};

export type ResolvedPlace = {
  label: string;
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
};

export type RouteCoordinate = {
  latitude: number;
  longitude: number;
};

export type RouteNavigationStep = {
  instruction: string;
  distanceMeters: number;
  coordinate: RouteCoordinate;
};

export type RoutePreview = {
  coordinates: RouteCoordinate[];
  distanceMeters: number;
  expectedTravelTimeSeconds: number;
  routeName: string;
};

export type RouteAlternative = RoutePreview & {
  advisoryNotices: string[];
  stepInstructions: string[];
  navigationSteps: RouteNavigationStep[];
};

type TurtleMapSearchEvents = {
  onSuggestions: (event: { query: string; suggestions: PlaceSuggestion[] }) => void;
  onSearchError: (event: { query: string; message: string }) => void;
};

declare class TurtleMapSearchNativeModule extends NativeModule<TurtleMapSearchEvents> {
  updateQuery(query: string, latitude: number, longitude: number, latitudeDelta: number, longitudeDelta: number): Promise<void>;
  clear(): Promise<void>;
  resolveSuggestion(id: string): Promise<ResolvedPlace>;
  resolveRouteWaypoint(
    query: string,
    centerLatitude: number,
    centerLongitude: number,
    latitudeDelta: number,
    longitudeDelta: number,
  ): Promise<ResolvedPlace>;
  calculateRoute(
    originLatitude: number,
    originLongitude: number,
    destinationLatitude: number,
    destinationLongitude: number,
    travelMode: string,
    avoidTolls: boolean,
    avoidHighways: boolean,
  ): Promise<RoutePreview>;
  calculateRouteAlternatives(
    originLatitude: number,
    originLongitude: number,
    destinationLatitude: number,
    destinationLongitude: number,
    travelMode: string,
    avoidTolls: boolean,
    avoidHighways: boolean,
  ): Promise<RouteAlternative[]>;
}

export default requireOptionalNativeModule<TurtleMapSearchNativeModule>("TurtleMapSearch");
