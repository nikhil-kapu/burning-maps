import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { API_URL } from "../api/client";
import type { AuthSession } from "../types";

const TASK = "turtle-buddy-active-journey-location";
const ACTIVE_JOURNEY_KEY = "turtle-buddy.active-journey.v1";
const SESSION_KEY = "turtle-buddy.session.v1";

type LocationPayload = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  recordedAt: string;
};

let foregroundSubscription: Location.LocationSubscription | undefined;

async function readSession(): Promise<AuthSession | null> {
  const value = await SecureStore.getItemAsync(SESSION_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value) as AuthSession;
  } catch {
    return null;
  }
}

async function persistSession(session: AuthSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

async function refreshSession(session: AuthSession): Promise<AuthSession | null> {
  const response = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: AuthSession };
  if (!body.data?.accessToken || !body.data.refreshToken) return null;
  await persistSession(body.data);
  return body.data;
}

async function uploadLocation(journeyId: string, payload: LocationPayload): Promise<void> {
  let session = await readSession();
  if (!session) return;
  const send = (accessToken: string) => fetch(`${API_URL}/v1/journeys/${journeyId}/location`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  let response = await send(session.accessToken);
  if (response.status === 401) {
    session = await refreshSession(session);
    if (session) response = await send(session.accessToken);
  }
  if (!response.ok && response.status !== 409) throw new Error(`Location upload failed with ${response.status}.`);
}

async function startForegroundUpdates(journeyId: string): Promise<void> {
  if (foregroundSubscription) return;
  foregroundSubscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, distanceInterval: 250, timeInterval: 5 * 60_000 },
    (location) => {
      void uploadLocation(journeyId, {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracyMeters: location.coords.accuracy,
        recordedAt: new Date(location.timestamp).toISOString(),
      }).catch(() => undefined);
    },
  );
}

TaskManager.defineTask(TASK, async ({ data, error }) => {
  try {
    if (error || !data) return;
    const journeyId = await SecureStore.getItemAsync(ACTIVE_JOURNEY_KEY);
    if (!journeyId) return;
    const locations = (data as { locations?: Location.LocationObject[] }).locations ?? [];
    const latest = locations.at(-1);
    if (!latest) return;
    await uploadLocation(journeyId, {
      latitude: latest.coords.latitude,
      longitude: latest.coords.longitude,
      accuracyMeters: latest.coords.accuracy,
      recordedAt: new Date(latest.timestamp).toISOString(),
    });
  } catch {
    // Expo retries future background updates; errors intentionally avoid user data in logs.
  }
});

export async function startJourneyLocation(journeyId: string): Promise<{ foreground: boolean; background: boolean }> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") return { foreground: false, background: false };
  await SecureStore.setItemAsync(ACTIVE_JOURNEY_KEY, journeyId);
  const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  await uploadLocation(journeyId, {
    latitude: current.coords.latitude,
    longitude: current.coords.longitude,
    accuracyMeters: current.coords.accuracy,
    recordedAt: new Date(current.timestamp).toISOString(),
  }).catch(() => undefined);
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status === "granted" && !(await Location.hasStartedLocationUpdatesAsync(TASK))) {
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 250,
      timeInterval: 5 * 60_000,
      pausesUpdatesAutomatically: true,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Turtle Maps route active",
        notificationBody: "Location sharing stops when you end the journey.",
      },
    });
  } else if (background.status !== "granted") {
    await startForegroundUpdates(journeyId);
  }
  return { foreground: true, background: background.status === "granted" };
}

export async function resumeJourneyLocation(journeyId: string): Promise<{ foreground: boolean; background: boolean }> {
  const activeJourneyId = await SecureStore.getItemAsync(ACTIVE_JOURNEY_KEY);
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync();
  const backgroundStarted = await Location.hasStartedLocationUpdatesAsync(TASK);
  if (activeJourneyId === journeyId && foreground.status === "granted" && !backgroundStarted) {
    await startForegroundUpdates(journeyId);
  }
  return {
    foreground: activeJourneyId === journeyId && foreground.status === "granted",
    background: activeJourneyId === journeyId && background.status === "granted" && backgroundStarted,
  };
}

export async function stopJourneyLocation(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_JOURNEY_KEY);
  foregroundSubscription?.remove();
  foregroundSubscription = undefined;
  if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
}
