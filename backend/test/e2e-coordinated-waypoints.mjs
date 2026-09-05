import assert from "node:assert/strict";
import pg from "pg";

const base = process.env.API_URL ?? "http://127.0.0.1:8080";
const suffix = Date.now().toString(36);
const email = `route-qa-${suffix}@example.com`;
const username = `route_qa_${suffix}`.slice(0, 24);
const password = "TurtleMapsRouteQA2026";
let accessToken = "";
let database;

function encodePolyline(coordinates) {
  let previousLatitude = 0;
  let previousLongitude = 0;
  const encodeValue = (value) => {
    let shifted = value < 0 ? ~(value << 1) : value << 1;
    let encoded = "";
    while (shifted >= 0x20) {
      encoded += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
      shifted >>= 5;
    }
    return encoded + String.fromCharCode(shifted + 63);
  };
  return coordinates.map((coordinate) => {
    const latitude = Math.round(coordinate.latitude * 100_000);
    const longitude = Math.round(coordinate.longitude * 100_000);
    const value = encodeValue(latitude - previousLatitude) + encodeValue(longitude - previousLongitude);
    previousLatitude = latitude;
    previousLongitude = longitude;
    return value;
  }).join("");
}

async function request(path, { method = "GET", body, auth = false } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(auth ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = response.status === 204 ? null : await response.json();
  assert.equal(response.ok, true, `${method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  return payload?.data;
}

try {
  const signup = await request("/v1/auth/sign-up", {
    method: "POST",
    body: { email, username, displayName: "Route QA Traveler", password, timezone: "America/Los_Angeles", termsAccepted: true, ageConfirmed: true },
  });
  const session = await request("/v1/auth/verify-email", { method: "POST", body: { email, code: signup.devCode } });
  accessToken = session.accessToken;
  await request("/v1/me", { method: "PATCH", auth: true, body: { phoneE164: "+14155550199" } });

  const journey = await request("/v1/journeys", {
    method: "POST",
    auth: true,
    body: {
      title: "Coordinated waypoint regression",
      originLabel: "San Francisco, CA",
      destinationLabel: "Monterey, CA",
      destinationCoordinate: { latitude: 36.6002, longitude: -121.8947 },
      travelMode: "driving",
      preferences: { avoidTolls: false, avoidHighways: false, avoidFerries: false, fewerTransfers: false, quietRide: false },
      agentInstructions: null,
      companionUpdatesEnabled: false,
      companionCallEnabled: false,
      updateDelayThresholdMinutes: 15,
      expectedArrivalAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString(),
      checkInIntervalMinutes: 30,
      graceMinutes: 15,
      voiceCallEnabled: false,
      notes: "Synthetic route-selection regression",
      contactIds: [],
    },
  });

  database = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://turtle:turtle@127.0.0.1:5433/turtle_buddy" });
  await database.connect();
  const legacyPreferences = { ...journey.preferences, viaWaypoints: ["Fremont and Santa Cruz"] };
  await database.query("UPDATE journeys SET journey_preferences=$2::jsonb WHERE id=$1", [journey.id, JSON.stringify(legacyPreferences)]);

  const repaired = await request(`/v1/journeys/${journey.id}`, { auth: true });
  assert.deepEqual(repaired.preferences.viaWaypoints, ["Fremont", "Santa Cruz"]);

  const selected = await request(`/v1/journeys/${journey.id}/route-selection`, {
    method: "POST",
    auth: true,
    body: {
      candidateId: "coordinated-waypoint-regression",
      label: "Scenic pick",
      rationale: "Includes both required places in order.",
      durationSeconds: 10_800,
      distanceMeters: 205_000,
      waypointLabels: ["Fremont, CA, United States", "Santa Cruz, CA, United States"],
      routeNames: ["Test route"],
      routePolyline: encodePolyline([
        { latitude: 37.7749, longitude: -122.4194 },
        { latitude: 37.5485, longitude: -121.9886 },
        { latitude: 36.9741, longitude: -122.0308 },
        { latitude: 36.6002, longitude: -121.8947 },
      ]),
      routeWaypoints: [
        { label: "Fremont, CA, United States", latitude: 37.5485, longitude: -121.9886, role: "required" },
        { label: "Santa Cruz, CA, United States", latitude: 36.9741, longitude: -122.0308, role: "required" },
      ],
    },
  });
  assert.deepEqual(selected.preferences.viaWaypoints, ["Fremont", "Santa Cruz"]);
  assert.deepEqual(selected.preferences.selectedRoute.waypointLabels, ["Fremont, CA, United States", "Santa Cruz, CA, United States"]);
  assert.equal(typeof selected.preferences.selectedRoute.routePolyline, "string");
  assert.equal(selected.preferences.selectedRoute.routeWaypoints.length, 2);

  const started = await request(`/v1/journeys/${journey.id}/start`, { method: "POST", auth: true, body: {} });
  assert.equal(started.status, "active");
  console.log("Coordinated-waypoint route selection and journey start passed.");
} finally {
  if (database) {
    await database.query("DELETE FROM users WHERE email=$1", [email]);
    await database.end();
  }
}
