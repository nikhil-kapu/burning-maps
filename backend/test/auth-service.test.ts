import assert from "node:assert/strict";
import test from "node:test";
import { publicUser, type UserRow } from "../src/services/auth-service.js";

function row(ageConfirmedAt: Date | null): UserRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    username: "route_tester",
    email: "route-tester@example.com",
    display_name: "Route Tester",
    password_hash: null,
    email_verified_at: new Date("2026-08-26T00:00:00Z"),
    timezone: "America/Los_Angeles",
    phone_e164: null,
    emergency_number: null,
    clerk_password_enabled: true,
    terms_accepted_at: new Date("2026-08-26T00:00:00Z"),
    age_confirmed_at: ageConfirmedAt,
  };
}

test("public user exposes the one-time age onboarding state", () => {
  assert.equal(publicUser(row(null)).ageConfirmed, false);
  assert.equal(publicUser(row(new Date("2026-08-26T01:00:00Z"))).ageConfirmed, true);
});
