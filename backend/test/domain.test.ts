import assert from "node:assert/strict";
import test from "node:test";
import { getEscalationStages, nextCheckInAt } from "../src/domain.js";

test("escalation stages are deterministic and respect the grace window", () => {
  assert.deepEqual(getEscalationStages({ overdueMinutes: -1, graceMinutes: 15, voiceEnabled: true }), []);
  assert.deepEqual(getEscalationStages({ overdueMinutes: 0, graceMinutes: 15, voiceEnabled: true }), ["traveler_push"]);
  assert.deepEqual(getEscalationStages({ overdueMinutes: 5, graceMinutes: 15, voiceEnabled: true }), ["traveler_push", "traveler_voice"]);
  assert.deepEqual(getEscalationStages({ overdueMinutes: 15, graceMinutes: 15, voiceEnabled: true }), ["traveler_push", "traveler_voice", "contact_notice"]);
  assert.deepEqual(getEscalationStages({ overdueMinutes: 15, graceMinutes: 15, voiceEnabled: false }), ["traveler_push", "contact_notice"]);
});

test("next check-in never exceeds the expected arrival", () => {
  const now = new Date("2026-08-21T12:00:00Z");
  assert.equal(nextCheckInAt(now, 30, new Date("2026-08-21T14:00:00Z")).toISOString(), "2026-08-21T12:30:00.000Z");
  assert.equal(nextCheckInAt(now, 30, new Date("2026-08-21T12:10:00Z")).toISOString(), "2026-08-21T12:10:00.000Z");
});

