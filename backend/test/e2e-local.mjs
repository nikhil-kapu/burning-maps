import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import pg from "pg";

const base = process.env.API_URL ?? "http://127.0.0.1:8080";
const suffix = Date.now().toString(36);
const email = `qa-${suffix}@example.com`;
const username = `qa_${suffix}`.slice(0, 24);
const password = "TurtleBuddyQA2026";
let accessToken = "";
let refreshToken = "";
let viewerAccessToken = "";

function decryptPrivateText(value) {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  assert.equal(version, "v1");
  const pepper = process.env.REFRESH_TOKEN_PEPPER ?? "development-refresh-token-pepper-change-me";
  const key = createHash("sha256").update(pepper).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
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
  const parsed = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(parsed)}`);
  return parsed?.data;
}

async function expectFailure(path, status, { method = "GET", body, auth = false } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(auth ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.status, status, `${method} ${path} should fail with ${status}`);
  return response.json();
}

const signup = await request("/v1/auth/sign-up", {
  method: "POST",
  body: { email, username, displayName: "QA Traveler", password, timezone: "America/Los_Angeles", termsAccepted: true, ageConfirmed: true },
});
assert.equal(signup.verificationRequired, true);
assert.match(signup.devCode, /^\d{6}$/);

const session = await request("/v1/auth/verify-email", { method: "POST", body: { email, code: signup.devCode } });
assert.ok(session.accessToken);
assert.ok(session.refreshToken);
accessToken = session.accessToken;
refreshToken = session.refreshToken;

const refreshed = await request("/v1/auth/refresh", { method: "POST", body: { refreshToken } });
assert.notEqual(refreshed.refreshToken, refreshToken);
assert.ok(refreshed.accessToken);
accessToken = refreshed.accessToken;
refreshToken = refreshed.refreshToken;

const me = await request("/v1/me", { auth: true });
assert.equal(me.username, username);
assert.equal(me.ageConfirmed, true);

const usernameRecovery = await request("/v1/auth/forgot-username", { method: "POST", body: { email } });
assert.match(usernameRecovery.message, /email/i);

const changedPassword = `${password}Changed`;
await request("/v1/me/change-password", { method: "POST", auth: true, body: { currentPassword: password, newPassword: changedPassword } });
await expectFailure("/v1/auth/sign-in", 401, { method: "POST", body: { identifier: username, password } });
let reauthenticated = await request("/v1/auth/sign-in", { method: "POST", body: { identifier: username, password: changedPassword } });
accessToken = reauthenticated.accessToken;
refreshToken = reauthenticated.refreshToken;
await request("/v1/auth/sign-out", { method: "POST", body: { refreshToken } });
await expectFailure("/v1/auth/refresh", 401, { method: "POST", body: { refreshToken } });
reauthenticated = await request("/v1/auth/sign-in", { method: "POST", body: { identifier: username, password: changedPassword } });
accessToken = reauthenticated.accessToken;
refreshToken = reauthenticated.refreshToken;

const updated = await request("/v1/me", { method: "PATCH", auth: true, body: { phoneE164: "+14155550199", emergencyNumber: "911" } });
assert.equal(updated.phoneE164, "+14155550199");
assert.equal(updated.emergencyNumber, "911");

await expectFailure("/v1/contacts", 400, {
  method: "POST",
  auth: true,
  body: { name: "Invalid contact", relationship: "Friend", phoneE164: null, email: "invalid@example.com", priority: 1, channels: ["sms"], enabled: true },
});

const contact = await request("/v1/contacts", {
  method: "POST",
  auth: true,
  body: { name: "Morgan", relationship: "Friend", phoneE164: "+14155550198", email: "morgan@example.com", priority: 1, channels: ["sms", "email"], enabled: true },
});
assert.ok(contact.id);

await expectFailure(`/v1/contacts/${contact.id}`, 400, {
  method: "PATCH",
  auth: true,
  body: { phoneE164: null },
});
const updatedContact = await request(`/v1/contacts/${contact.id}`, { method: "PATCH", auth: true, body: { relationship: "Trusted friend" } });
assert.equal(updatedContact.relationship, "Trusted friend");

const removableContact = await request("/v1/contacts", {
  method: "POST",
  auth: true,
  body: { name: "Removable contact", relationship: "Friend", phoneE164: null, email: "remove@example.com", priority: 2, channels: ["email"], enabled: true },
});
await request(`/v1/contacts/${removableContact.id}`, { method: "DELETE", auth: true });
assert.equal((await request("/v1/contacts", { auth: true })).some((value) => value.id === removableContact.id), false);

const journey = await request("/v1/journeys", {
  method: "POST",
  auth: true,
  body: {
    title: "QA evening walk",
    originLabel: "Home",
    destinationLabel: "Riverside cafe",
    destinationCoordinate: { latitude: 37.7694, longitude: -122.4862 },
    travelMode: "walking",
    agentInstructions: "Prefer a scenic route, remind me about a coffee break after 90 minutes, use well-lit populated stops after dark, and only call for a meaningful delay.",
    companionUpdatesEnabled: true,
    companionCallEnabled: true,
    updateDelayThresholdMinutes: 15,
    expectedArrivalAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    checkInIntervalMinutes: 30,
    graceMinutes: 15,
    voiceCallEnabled: false,
    notes: "Synthetic QA journey",
    contactIds: [contact.id],
  },
});
assert.equal(journey.status, "planned");
assert.equal(journey.travelMode, "walking");
assert.equal(journey.companionCallEnabled, true);
assert.match(journey.agentInstructions, /well-lit/);
assert.equal(journey.preferences.scenicRoute, true);
assert.equal(journey.preferences.saferStopsAfterDark, true);
assert.equal(journey.preferences.comfortStopAfterMinutes, 90);
assert.equal(journey.preferences.avoidHighways, true);
assert.equal(journey.preferences.quietRide, true);
assert.deepEqual(journey.destinationCoordinate, { latitude: 37.7694, longitude: -122.4862 });
assert.ok(journey.shareToken);
assert.match(journey.shareUrl, /^http:\/\/localhost:8080\/s\//);
assert.equal(journey.deliveryCapabilities.routeUpdatesLive, false);
assert.equal(journey.deliveryCapabilities.voiceCallsLive, false);
assert.equal(journey.deliveryCapabilities.publicShareLive, false);
assert.equal(journey.deliveryCapabilities.agentBriefAiLive, false);

const statusResponse = await fetch(`${base}/s/${journey.shareToken}`);
assert.equal(statusResponse.status, 200);
assert.match(await statusResponse.text(), /Riverside cafe/);

const cancellable = await request("/v1/journeys", {
  method: "POST",
  auth: true,
  body: {
    title: "QA cancellable plan",
    originLabel: "Hotel",
    destinationLabel: "Museum",
    destinationCoordinate: { latitude: 37.8008, longitude: -122.458 },
    travelMode: "bus",
    preferences: { avoidTolls: false, avoidHighways: false, avoidFerries: false, fewerTransfers: true, quietRide: false },
    companionUpdatesEnabled: true,
    companionCallEnabled: false,
    updateDelayThresholdMinutes: 30,
    expectedArrivalAt: new Date(Date.now() + 90 * 60_000).toISOString(),
    checkInIntervalMinutes: 30,
    graceMinutes: 15,
    voiceCallEnabled: false,
    notes: null,
    contactIds: [contact.id],
  },
});
const cancelled = await request(`/v1/journeys/${cancellable.id}/cancel`, { method: "POST", auth: true, body: {} });
assert.equal(cancelled.status, "cancelled");

await request("/v1/me", { method: "PATCH", auth: true, body: { phoneE164: null } });
const phoneRequired = await expectFailure(`/v1/journeys/${journey.id}/start`, 409, { method: "POST", auth: true, body: {} });
assert.equal(phoneRequired.error.code, "PHONE_REQUIRED_FOR_SHARING");
await request("/v1/me", { method: "PATCH", auth: true, body: { phoneE164: "+14155550199" } });
const started = await request(`/v1/journeys/${journey.id}/start`, { method: "POST", auth: true, body: {} });
assert.equal(started.status, "active");

const database = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://turtle:turtle@127.0.0.1:5433/turtle_buddy" });
await database.connect();
const invitationRecord = await database.query(
  "SELECT token_ciphertext FROM journey_share_invitations WHERE journey_id=$1 ORDER BY created_at LIMIT 1",
  [journey.id],
);
await database.end();
assert.equal(invitationRecord.rowCount, 1);
const invitationToken = decryptPrivateText(invitationRecord.rows[0].token_ciphertext);
const preview = await request(`/v1/share-invites/${invitationToken}/preview`);
assert.equal(preview.travelerName, "QA Traveler");
assert.equal(preview.destinationLabel, "Riverside cafe");
const landing = await fetch(`${base}/invite/${invitationToken}`);
assert.equal(landing.status, 200);
assert.match(await landing.text(), /shared a commute/);

const travelerAccessToken = accessToken;
const viewerEmail = `viewer-${suffix}@example.com`;
const viewerUsername = `viewer_${suffix}`.slice(0, 24);
const viewerPassword = "ViewerTurtle2026";
const viewerSignup = await request("/v1/auth/sign-up", {
  method: "POST",
  body: { email: viewerEmail, username: viewerUsername, displayName: "Trusted Viewer", password: viewerPassword, timezone: "America/Los_Angeles", termsAccepted: true, ageConfirmed: true },
});
const viewerSession = await request("/v1/auth/verify-email", { method: "POST", body: { email: viewerEmail, code: viewerSignup.devCode } });
accessToken = viewerSession.accessToken;
viewerAccessToken = viewerSession.accessToken;
const accepted = await request(`/v1/share-invites/${invitationToken}/accept`, { method: "POST", auth: true, body: {} });
assert.equal(accepted.journeyId, journey.id);
const shared = await request("/v1/shared-journeys", { auth: true });
assert.equal(shared.length, 1);
assert.equal(shared[0].journeyId, journey.id);
assert.equal(shared[0].permissions.controlJourney, false);
assert.equal(shared[0].permissions.viewPreciseLocation, false);
assert.equal("destinationCoordinate" in shared[0], false);
assert.equal("notes" in shared[0], false);
await expectFailure(`/v1/journeys/${journey.id}`, 404, { auth: true });
accessToken = travelerAccessToken;
const resent = await request(`/v1/journeys/${journey.id}/share-invites/resend`, { method: "POST", auth: true, body: {} });
assert.equal(resent.recipientCount, 1);

const overlapping = await request("/v1/journeys", {
  method: "POST",
  auth: true,
  body: {
    title: "QA overlapping plan",
    originLabel: "Park",
    destinationLabel: "Library",
    destinationCoordinate: { latitude: 37.778, longitude: -122.415 },
    travelMode: "walking",
    companionUpdatesEnabled: false,
    companionCallEnabled: false,
    updateDelayThresholdMinutes: 15,
    expectedArrivalAt: new Date(Date.now() + 75 * 60_000).toISOString(),
    checkInIntervalMinutes: 30,
    graceMinutes: 15,
    voiceCallEnabled: false,
    notes: null,
    contactIds: [contact.id],
  },
});
await expectFailure(`/v1/journeys/${overlapping.id}/start`, 409, { method: "POST", auth: true, body: {} });
await request(`/v1/journeys/${overlapping.id}/cancel`, { method: "POST", auth: true, body: {} });

const location = await request(`/v1/journeys/${journey.id}/location`, {
  method: "POST",
  auth: true,
  body: { latitude: 37.77, longitude: -122.48, accuracyMeters: 25, coarseArea: "Outer Richmond", recordedAt: new Date().toISOString() },
});
assert.equal(location.accepted, true);

const extendedArrival = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
const extended = await request(`/v1/journeys/${journey.id}/extend`, { method: "POST", auth: true, body: { expectedArrivalAt: extendedArrival } });
assert.equal(extended.expectedArrivalAt, extendedArrival);

const buddyUpdate = await request(`/v1/journeys/${journey.id}/simulate-companion-update`, {
  method: "POST",
  auth: true,
  body: { idempotencyKey: crypto.randomUUID(), summary: "Traffic changed and the updated arrival is about 20 minutes later." },
});
assert.deepEqual(buddyUpdate.channels, ["push", "voice"]);

const checkedIn = await request(`/v1/journeys/${journey.id}/check-in`, { method: "POST", auth: true, body: {} });
assert.equal(checkedIn.status, "active");
assert.ok(checkedIn.nextCheckInAt);

const callRequest = await request(`/v1/journeys/${journey.id}/call-me`, {
  method: "POST",
  auth: true,
  body: { idempotencyKey: crypto.randomUUID() },
});
assert.equal(callRequest.queued, true);
assert.equal(callRequest.deliveryMode, "simulated");

const manualAlert = await request(`/v1/journeys/${journey.id}/alert`, {
  method: "POST",
  auth: true,
  body: { holdConfirmed: true, idempotencyKey: crypto.randomUUID(), message: "Synthetic manual alert" },
});
assert.equal(manualAlert.queued, true);
assert.equal(manualAlert.recipientCount, 1);
assert.equal(manualAlert.deliveryMode, "simulated");

const ended = await request(`/v1/journeys/${journey.id}/end`, { method: "POST", auth: true, body: {} });
assert.equal(ended.status, "ended");

const recovery = await request("/v1/auth/forgot-password", { method: "POST", body: { email } });
assert.match(recovery.devCode, /^\d{6}$/);
const newPassword = `${password}New`;
await request("/v1/auth/reset-password", { method: "POST", body: { email, code: recovery.devCode, password: newPassword } });
const recoveredSession = await request("/v1/auth/sign-in", { method: "POST", body: { identifier: username, password: newPassword } });
accessToken = recoveredSession.accessToken;
await request("/v1/me", { method: "DELETE", auth: true, body: { password: newPassword, confirmation: "DELETE" } });
accessToken = viewerAccessToken;
await request("/v1/me", { method: "DELETE", auth: true, body: { password: viewerPassword, confirmation: "DELETE" } });
console.log("Turtle Maps local API E2E passed.");
