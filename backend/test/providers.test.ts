import assert from "node:assert/strict";
import test from "node:test";
import { resetConfigForTests } from "../src/config.js";
import { interpretJourneyBrief } from "../src/services/journey-brief.js";
import { rankRouteCandidates } from "../src/services/route-candidate-ranker.js";
import { sendPush } from "../src/services/push.js";
import { sendSms } from "../src/services/sms.js";
import { placeWellnessCall } from "../src/services/voice.js";

function restoreEnvironment(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfigForTests();
}

test("Vapi calls use backend-only assistant, phone, and customer configuration", async () => {
  const keys = ["VOICE_MODE", "VAPI_PRIVATE_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_ASSISTANT_ID"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  process.env.VOICE_MODE = "vapi";
  process.env.VAPI_PRIVATE_KEY = "synthetic-vapi-private-key";
  process.env.VAPI_PHONE_NUMBER_ID = "synthetic-phone-id";
  process.env.VAPI_ASSISTANT_ID = "synthetic-assistant-id";
  resetConfigForTests();
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://api.vapi.ai/call");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-vapi-private-key");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "call-test-id" }), { status: 201, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await placeWellnessCall({ to: "+14155550199", travelerName: "Avery", journeyTitle: "Evening trip" });
    assert.equal(result.providerId, "call-test-id");
    assert.equal(requestBody?.assistantId, "synthetic-assistant-id");
    assert.equal(requestBody?.phoneNumberId, "synthetic-phone-id");
    assert.deepEqual(requestBody?.customer, { number: "+14155550199" });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("Twilio SMS sends the selected contact number and configured sender", async () => {
  const keys = ["SMS_MODE", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let form: URLSearchParams | undefined;
  process.env.SMS_MODE = "twilio";
  process.env.TWILIO_ACCOUNT_SID = "ACsynthetic";
  process.env.TWILIO_AUTH_TOKEN = "synthetic-token";
  process.env.TWILIO_FROM_NUMBER = "+14155550100";
  resetConfigForTests();
  globalThis.fetch = (async (input, init) => {
    assert.match(String(input), /ACsynthetic\/Messages\.json$/);
    form = new URLSearchParams(String(init?.body));
    return new Response(JSON.stringify({ sid: "SMsynthetic" }), { status: 201, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await sendSms({ to: "+14155550198", body: "Synthetic journey update" });
    assert.equal(result.providerId, "SMsynthetic");
    assert.equal(form?.get("To"), "+14155550198");
    assert.equal(form?.get("From"), "+14155550100");
    assert.equal(form?.get("Body"), "Synthetic journey update");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("Expo Push parses a successful provider receipt", async () => {
  const previous = { PUSH_MODE: process.env.PUSH_MODE };
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  process.env.PUSH_MODE = "expo";
  resetConfigForTests();
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://exp.host/--/api/v2/push/send");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ data: { id: "push-receipt-id", status: "ok" } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await sendPush({ token: "ExponentPushToken[synthetic]", title: "Route update", body: "Arrival shifted" });
    assert.equal(result.providerId, "push-receipt-id");
    assert.equal(requestBody?.to, "ExponentPushToken[synthetic]");
    assert.equal(requestBody?.title, "Route update");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("OpenRouter route briefs use strict structured output and remain constrained", async () => {
  const keys = ["AGENT_BRIEF_MODE", "OPENROUTER_API_KEY", "OPENROUTER_MODEL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  process.env.AGENT_BRIEF_MODE = "openrouter";
  process.env.OPENROUTER_API_KEY = "synthetic-openrouter-key";
  process.env.OPENROUTER_MODEL = "synthetic/structured-model";
  resetConfigForTests();
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-openrouter-key");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        avoidTolls: false,
        avoidHighways: true,
        avoidFerries: false,
        fewerTransfers: false,
        quietRide: true,
        scenicRoute: true,
        saferStopsAfterDark: false,
        comfortStopAfterMinutes: 75,
        viaWaypoints: ["Fremont"],
        routeObjective: {
          label: "Peaceful",
          summary: "Prefer peaceful back roads through Fremont with a timed rest break.",
          detourBudgetPercent: 35,
          rankingCriteria: ["quiet roads", "rest timing", "reasonable detour"],
          suggestedAnchors: [{ query: "quiet park near Fremont", purpose: "calmer road option", insertAfterWaypointIndex: 0, targetProgressPercent: 55 }],
        },
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await interpretJourneyBrief("Take a peaceful back route through Fremont and remind me to rest in about seventy-five minutes.");
    assert.equal(result.scenicRoute, true);
    assert.equal(result.avoidHighways, true);
    assert.equal(result.quietRide, true);
    assert.equal(result.comfortStopAfterMinutes, 75);
    assert.deepEqual(result.viaWaypoints, ["Fremont"]);
    assert.equal(result.routeObjective?.label, "Peaceful");
    assert.equal(result.routeObjective?.detourBudgetPercent, 60);
    assert.equal(result.routeObjective?.suggestedAnchors[0]?.query, "quiet park near Fremont");
    assert.equal(requestBody?.model, "synthetic/structured-model");
    assert.deepEqual(requestBody?.provider, { require_parameters: true });
    assert.equal((requestBody?.response_format as { type?: string })?.type, "json_schema");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("OpenAI route briefs use Responses structured output without provider storage", async () => {
  const keys = ["AGENT_BRIEF_MODE", "OPENAI_API_KEY", "OPENAI_MODEL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  process.env.AGENT_BRIEF_MODE = "openai";
  process.env.OPENAI_API_KEY = "synthetic-openai-key";
  process.env.OPENAI_MODEL = "gpt-4o-mini";
  resetConfigForTests();
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/responses");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-openai-key");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            avoidTolls: true,
            avoidHighways: false,
            avoidFerries: false,
            fewerTransfers: false,
            quietRide: false,
            scenicRoute: true,
            saferStopsAfterDark: true,
            comfortStopAfterMinutes: null,
            viaWaypoints: ["Fremont"],
            routeObjective: {
              label: "Scenic",
              summary: "Prefer a scenic drive through Fremont while avoiding tolls and using well-lit stops.",
              detourBudgetPercent: 55,
              rankingCriteria: ["scenic character", "well-lit stops", "reasonable detour"],
              suggestedAnchors: [{ query: "Niles Canyon", purpose: "scenic road corridor", insertAfterWaypointIndex: 1, targetProgressPercent: 72 }],
            },
          }),
        }],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await interpretJourneyBrief(
      "Take a scenic route through Fremont, avoid tolls, and use well-lit stops after dark.",
      {},
      { originLabel: "San Francisco, CA", destinationLabel: "San Jose, CA", travelMode: "driving" },
    );
    assert.equal(result.scenicRoute, true);
    assert.equal(result.avoidTolls, true);
    assert.equal(result.saferStopsAfterDark, true);
    assert.deepEqual(result.viaWaypoints, ["Fremont"]);
    assert.equal(result.routeObjective?.label, "Scenic");
    assert.equal(result.routeObjective?.detourBudgetPercent, 60);
    assert.deepEqual(result.routeObjective?.suggestedAnchors.map((anchor) => anchor.query), ["Niles Canyon"]);
    assert.equal(requestBody?.model, "gpt-4o-mini");
    assert.equal(requestBody?.store, false);
    const text = requestBody?.text as { format?: { type?: string; strict?: boolean } };
    assert.equal(text.format?.type, "json_schema");
    assert.equal(text.format?.strict, true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("OpenAI judges only calculated route candidates and preserves the detour guardrail", async () => {
  const keys = ["AGENT_BRIEF_MODE", "OPENAI_API_KEY", "OPENAI_MODEL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  process.env.AGENT_BRIEF_MODE = "openai";
  process.env.OPENAI_API_KEY = "synthetic-openai-key";
  process.env.OPENAI_MODEL = "gpt-4o-mini";
  resetConfigForTests();
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/responses");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      output: [{ content: [{ type: "output_text", text: JSON.stringify({
        recommendedCandidateId: "scenic-validated",
        evaluations: [
          { candidateId: "quick", matchScore: 58, rationale: "Fastest, but with little scenic evidence." },
          { candidateId: "scenic-validated", matchScore: 94, rationale: "Uses the Maps-resolved shoreline anchor within the detour budget." },
          { candidateId: "too-long", matchScore: 99, rationale: "Strong scenic evidence but a very large detour." },
        ],
      }) }] }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const candidate = (candidateId: string, profile: "standard" | "agent_anchor", durationSeconds: number, anchorLabel?: string) => ({
    candidateId,
    profile,
    durationSeconds,
    distanceMeters: durationSeconds * 20,
    routeNames: [candidateId === "quick" ? "I-880 S" : "Shoreline Road"],
    advisoryNotices: [],
    stepInstructions: [],
    anchorEvidence: anchorLabel ? [{ label: anchorLabel, purpose: "scenic shoreline" }] : [],
  });
  try {
    const ranking = await rankRouteCandidates({
      instructions: "Take a scenic route through Fremont.",
      objective: {
        label: "Scenic",
        summary: "Prefer scenic character through Fremont.",
        detourBudgetPercent: 40,
        rankingCriteria: ["scenic character", "reasonable detour"],
        suggestedAnchors: [],
      },
      candidates: [
        candidate("quick", "standard", 3_600),
        candidate("scenic-validated", "agent_anchor", 4_500, "Baylands Nature Preserve"),
        candidate("too-long", "agent_anchor", 7_200, "Distant overlook"),
      ],
    });
    assert.equal(ranking.rankingMode, "ai");
    assert.equal(ranking.recommendedCandidateId, "scenic-validated");
    assert.equal(requestBody?.store, false);
    assert.deepEqual(ranking.evaluations.map((evaluation) => evaluation.candidateId), ["quick", "scenic-validated", "too-long"]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("route ranking recommendation follows the highest eligible evidence score", async () => {
  const keys = ["AGENT_BRIEF_MODE", "OPENAI_API_KEY", "OPENAI_MODEL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.AGENT_BRIEF_MODE = "openai";
  process.env.OPENAI_API_KEY = "synthetic-openai-key";
  process.env.OPENAI_MODEL = "gpt-4o-mini";
  resetConfigForTests();
  globalThis.fetch = (async () => new Response(JSON.stringify({
    output: [{ content: [{ type: "output_text", text: JSON.stringify({
      recommendedCandidateId: "quick",
      evaluations: [
        { candidateId: "quick", matchScore: 35, rationale: "Fast but does not satisfy the scenic objective." },
        { candidateId: "scenic", matchScore: 91, rationale: "Uses a Maps-validated scenic anchor within budget." },
      ],
    }) }] }],
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  try {
    const ranking = await rankRouteCandidates({
      instructions: "Use a scenic route.",
      objective: {
        label: "Scenic",
        summary: "Prefer scenic character.",
        detourBudgetPercent: 60,
        rankingCriteria: ["scenic character"],
        suggestedAnchors: [],
      },
      candidates: [
        { candidateId: "quick", profile: "standard", durationSeconds: 3_600, distanceMeters: 75_000, routeNames: ["I-880 S"], advisoryNotices: [], stepInstructions: [], anchorEvidence: [] },
        { candidateId: "scenic", profile: "agent_anchor", durationSeconds: 4_500, distanceMeters: 84_000, routeNames: ["Niles Canyon Road"], advisoryNotices: [], stepInstructions: [], anchorEvidence: [{ label: "Niles Canyon", purpose: "scenic corridor" }] },
      ],
    });
    assert.equal(ranking.recommendedCandidateId, "scenic");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});
