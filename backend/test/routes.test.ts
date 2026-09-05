import assert from "node:assert/strict";
import test from "node:test";
import { resetConfigForTests } from "../src/config.js";
import { getRouteSnapshot, inferJourneyPreferences, missingRequiredWaypoints, normalizeViaWaypoints } from "../src/services/routes.js";
import { buildJourneyShareMessage } from "../src/worker.js";

test("trusted-recipient invitations are account-gated and clearly scoped", () => {
  const message = buildJourneyShareMessage({
    travelerName: "Avery",
    destinationLabel: "Riverside Cafe",
    contactName: "Morgan",
    inviteUrl: "https://journeys.example.com/invite/private-token",
  });
  assert.match(message, /Avery shared a commute/);
  assert.match(message, /Apple, Google, or email/);
  assert.match(message, /private link is for Morgan/);
  assert.match(message, /\/invite\/private-token/);
  assert.doesNotMatch(message, /precise|coordinates/i);
});

test("the natural-language route brief becomes actionable journey preferences", () => {
  const preferences = inferJourneyPreferences(
    "Prefer a scenic route through Fremont, remind me about a coffee break after 90 minutes, use well-lit populated stops after dark, and only call for meaningful updates.",
  );
  assert.deepEqual(preferences, {
    avoidTolls: false,
    avoidHighways: true,
    avoidFerries: false,
    fewerTransfers: false,
    quietRide: true,
    scenicRoute: true,
    saferStopsAfterDark: true,
    comfortStopAfterMinutes: 90,
    viaWaypoints: ["Fremont"],
    routeObjective: {
      label: "Scenic",
      summary: "Prefer a scenic route through Fremont, remind me about a coffee break after 90 minutes, use well-lit populated stops after dark, and only call for meaningful up",
      detourBudgetPercent: 60,
      rankingCriteria: ["scenic character", "reasonable detour", "required places"],
      suggestedAnchors: [],
    },
  });
});

test("coordinated required places become distinct ordered waypoints", () => {
  const preferences = inferJourneyPreferences("Take a scenic route through Fremont and Santa Cruz.");
  assert.deepEqual(preferences.viaWaypoints, ["Fremont", "Santa Cruz"]);
  assert.deepEqual(normalizeViaWaypoints(["Fremont and Santa Cruz", "Fremont", "Santa Cruz"]), ["Fremont", "Santa Cruz"]);
});

test("route selection accepts separately resolved labels from a legacy combined waypoint", () => {
  assert.deepEqual(
    missingRequiredWaypoints(
      ["Fremont and Santa Cruz"],
      ["Fremont, CA, United States", "Santa Cruz, CA, United States"],
    ),
    [],
  );
  assert.deepEqual(
    missingRequiredWaypoints(
      ["Fremont and Santa Cruz"],
      ["Fremont, CA, United States"],
    ),
    ["Santa Cruz"],
  );
});

test("Google Routes maps transit preferences and parses a route snapshot", async () => {
  const previousMode = process.env.ROUTE_UPDATES_MODE;
  const previousKey = process.env.GOOGLE_ROUTES_API_KEY;
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  let fieldMask: string | null = null;
  process.env.ROUTE_UPDATES_MODE = "google";
  process.env.GOOGLE_ROUTES_API_KEY = "synthetic-test-key";
  resetConfigForTests();
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    fieldMask = new Headers(init?.headers).get("X-Goog-FieldMask");
    return new Response(JSON.stringify({ routes: [{ duration: "1234s", distanceMeters: 9876, warnings: ["Test warning"] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const snapshot = await getRouteSnapshot({
      origin: { latitude: 37.78, longitude: -122.42 },
      destination: { latitude: 37.8, longitude: -122.45 },
      travelMode: "bus",
      preferences: { fewerTransfers: true, viaWaypoints: ["Oakland, CA"] },
    });
    assert.deepEqual(snapshot, { durationSeconds: 1234, distanceMeters: 9876, warnings: ["Test warning"] });
    assert.equal(requestBody?.travelMode, "TRANSIT");
    assert.deepEqual(requestBody?.transitPreferences, { allowedTravelModes: ["BUS"], routingPreference: "FEWER_TRANSFERS" });
    assert.deepEqual(requestBody?.intermediates, [{ address: "Oakland, CA", via: true }]);
    assert.equal(fieldMask, "routes.duration,routes.distanceMeters,routes.warnings");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousMode === undefined) delete process.env.ROUTE_UPDATES_MODE; else process.env.ROUTE_UPDATES_MODE = previousMode;
    if (previousKey === undefined) delete process.env.GOOGLE_ROUTES_API_KEY; else process.env.GOOGLE_ROUTES_API_KEY = previousKey;
    resetConfigForTests();
  }
});

test("route monitoring stays inert when the provider is disabled", async () => {
  const previousMode = process.env.ROUTE_UPDATES_MODE;
  process.env.ROUTE_UPDATES_MODE = "disabled";
  resetConfigForTests();
  try {
    const snapshot = await getRouteSnapshot({
      origin: { latitude: 0, longitude: 0 },
      destination: { latitude: 1, longitude: 1 },
      travelMode: "driving",
      preferences: {},
    });
    assert.equal(snapshot, null);
  } finally {
    if (previousMode === undefined) delete process.env.ROUTE_UPDATES_MODE; else process.env.ROUTE_UPDATES_MODE = previousMode;
    resetConfigForTests();
  }
});
