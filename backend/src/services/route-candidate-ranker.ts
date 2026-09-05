import { z } from "zod";
import { getConfig } from "../config.js";
import type { AgentRouteObjective } from "./routes.js";

export const routeCandidateEvidenceSchema = z.object({
  candidateId: z.string().trim().min(1).max(80),
  profile: z.enum(["standard", "preference", "agent_anchor"]),
  durationSeconds: z.number().int().min(1).max(7 * 24 * 60 * 60),
  distanceMeters: z.number().min(1).max(20_000_000),
  routeNames: z.array(z.string().trim().min(1).max(160)).max(12),
  advisoryNotices: z.array(z.string().trim().min(1).max(240)).max(12),
  stepInstructions: z.array(z.string().trim().min(1).max(240)).max(80),
  anchorEvidence: z.array(z.object({
    label: z.string().trim().min(1).max(160),
    purpose: z.string().trim().min(1).max(160),
  })).max(6),
});

export type RouteCandidateEvidence = z.infer<typeof routeCandidateEvidenceSchema>;

export type RouteCandidateEvaluation = {
  candidateId: string;
  matchScore: number;
  rationale: string;
};

export type RouteCandidateRanking = {
  recommendedCandidateId: string;
  evaluations: RouteCandidateEvaluation[];
  rankingMode: "ai" | "deterministic";
};

const rankingSchema = z.object({
  recommendedCandidateId: z.string().trim().min(1).max(80),
  evaluations: z.array(z.object({
    candidateId: z.string().trim().min(1).max(80),
    matchScore: z.number().int().min(0).max(100),
    rationale: z.string().trim().min(2).max(220),
  })).min(1).max(10),
});

const rankingJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendedCandidateId: { type: "string", minLength: 1, maxLength: 80 },
    evaluations: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          candidateId: { type: "string", minLength: 1, maxLength: 80 },
          matchScore: { type: "integer", minimum: 0, maximum: 100 },
          rationale: { type: "string", minLength: 2, maxLength: 220 },
        },
        required: ["candidateId", "matchScore", "rationale"],
      },
    },
  },
  required: ["recommendedCandidateId", "evaluations"],
} as const;

const rankingSystemPrompt = "Judge routes against the traveler's optional route objective using only the supplied candidate evidence. Every candidate was calculated by Apple MapKit and already includes the traveler's required hard waypoints. Soft anchorEvidence contains places Maps actually resolved; you may use geographic knowledge to interpret verified place and road names, but never invent a road, feature, opening status, accessibility property, or safety claim. Balance objective match against the stated detour budget. Score every candidate once, preserve candidateId exactly, and recommend one supplied candidate. A faster route is not automatically a better match unless the objective or evidence supports it.";

export async function rankRouteCandidates(input: {
  instructions: string;
  objective: AgentRouteObjective;
  candidates: RouteCandidateEvidence[];
}): Promise<RouteCandidateRanking> {
  const candidates = input.candidates.map((candidate) => routeCandidateEvidenceSchema.parse(candidate));
  if (candidates.length === 0) throw new Error("No route candidates were supplied for ranking.");
  const fallback = deterministicRanking(input.objective, candidates);
  const config = getConfig();
  if (config.AGENT_BRIEF_MODE === "deterministic") return fallback;

  try {
    const modelRanking = config.AGENT_BRIEF_MODE === "openai"
      ? await rankWithOpenAi(input.instructions, input.objective, candidates)
      : await rankWithOpenRouter(input.instructions, input.objective, candidates);
    return validateRanking(modelRanking, input.objective, candidates, fallback);
  } catch {
    return fallback;
  }
}

async function rankWithOpenAi(
  instructions: string,
  objective: AgentRouteObjective,
  candidates: RouteCandidateEvidence[],
): Promise<z.infer<typeof rankingSchema>> {
  const config = getConfig();
  if (!config.OPENAI_API_KEY || !config.OPENAI_MODEL) throw new Error("OpenAI route-ranking configuration is incomplete.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      instructions: rankingSystemPrompt,
      input: JSON.stringify({ routeBrief: instructions, objective, candidates: withCandidateDeltas(candidates) }),
      text: { format: { type: "json_schema", name: "route_candidate_ranking", strict: true, schema: rankingJsonSchema } },
      store: false,
      max_output_tokens: 1_200,
    }),
    signal: AbortSignal.timeout(18_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message ?? `OpenAI failed with ${response.status}.`);
  const outputContent = payload.output?.flatMap((item) => item.content ?? []) ?? [];
  const content = payload.output_text ?? outputContent.find((item) => item.type === "output_text")?.text;
  if (!content) throw new Error("OpenAI returned an empty route ranking.");
  return rankingSchema.parse(JSON.parse(content));
}

async function rankWithOpenRouter(
  instructions: string,
  objective: AgentRouteObjective,
  candidates: RouteCandidateEvidence[],
): Promise<z.infer<typeof rankingSchema>> {
  const config = getConfig();
  if (!config.OPENROUTER_API_KEY || !config.OPENROUTER_MODEL) throw new Error("OpenRouter route-ranking configuration is incomplete.");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "X-Title": "Turtle Maps route ranking" },
    body: JSON.stringify({
      model: config.OPENROUTER_MODEL,
      messages: [
        { role: "system", content: rankingSystemPrompt },
        { role: "user", content: JSON.stringify({ routeBrief: instructions, objective, candidates: withCandidateDeltas(candidates) }) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "route_candidate_ranking", strict: true, schema: rankingJsonSchema } },
      provider: { require_parameters: true },
      temperature: 0,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message ?? `OpenRouter failed with ${response.status}.`);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned an empty route ranking.");
  return rankingSchema.parse(JSON.parse(content));
}

function withCandidateDeltas(candidates: RouteCandidateEvidence[]) {
  const fastest = Math.min(...candidates.map((candidate) => candidate.durationSeconds));
  const shortest = Math.min(...candidates.map((candidate) => candidate.distanceMeters));
  return candidates.map((candidate) => ({
    ...candidate,
    extraMinutesVsFastest: Math.round((candidate.durationSeconds - fastest) / 60),
    extraMilesVsShortest: Number(((candidate.distanceMeters - shortest) / 1609.344).toFixed(1)),
  }));
}

function deterministicRanking(objective: AgentRouteObjective, candidates: RouteCandidateEvidence[]): RouteCandidateRanking {
  const fastest = Math.min(...candidates.map((candidate) => candidate.durationSeconds));
  const maximumDuration = fastest * (1 + objective.detourBudgetPercent / 100);
  const evaluations = candidates.map((candidate) => {
    const withinBudget = candidate.durationSeconds <= maximumDuration;
    const detourRatio = Math.max(0, (candidate.durationSeconds - fastest) / fastest);
    const evidenceBonus = Math.min(36, candidate.anchorEvidence.length * 14 + (candidate.profile === "preference" ? 8 : 0));
    const score = Math.round(Math.max(0, Math.min(100, 62 + evidenceBonus - detourRatio * 55 - (withinBudget ? 0 : 35))));
    return {
      candidateId: candidate.candidateId,
      matchScore: score,
      rationale: candidate.anchorEvidence.length
        ? `Uses ${candidate.anchorEvidence.map((anchor) => anchor.label).join(" and ")} as validated evidence for the route brief.`
        : withinBudget
          ? "Keeps the requested places while balancing the route objective with travel time."
          : "Follows the requested places but exceeds the agent's default detour budget.",
    };
  });
  const eligible = evaluations.filter((evaluation) => {
    const candidate = candidates.find((value) => value.candidateId === evaluation.candidateId)!;
    return candidate.durationSeconds <= maximumDuration;
  });
  const recommended = [...(eligible.length ? eligible : evaluations)].sort((left, right) => right.matchScore - left.matchScore)[0]!;
  return { recommendedCandidateId: recommended.candidateId, evaluations, rankingMode: "deterministic" };
}

function validateRanking(
  modelRanking: z.infer<typeof rankingSchema>,
  objective: AgentRouteObjective,
  candidates: RouteCandidateEvidence[],
  fallback: RouteCandidateRanking,
): RouteCandidateRanking {
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const fastest = Math.min(...candidates.map((candidate) => candidate.durationSeconds));
  const maximumDuration = fastest * (1 + objective.detourBudgetPercent / 100);
  const seen = new Set<string>();
  const modelEvaluations = modelRanking.evaluations.filter((evaluation) => {
    if (!candidateIds.has(evaluation.candidateId) || seen.has(evaluation.candidateId)) return false;
    seen.add(evaluation.candidateId);
    return true;
  });
  const evaluations = candidates.map((candidate) => modelEvaluations.find((evaluation) => evaluation.candidateId === candidate.candidateId)
    ?? fallback.evaluations.find((evaluation) => evaluation.candidateId === candidate.candidateId)!);
  const eligibleEvaluations = evaluations
    .filter((evaluation) => candidates.find((candidate) => candidate.candidateId === evaluation.candidateId)!.durationSeconds <= maximumDuration)
    .sort((left, right) => right.matchScore - left.matchScore);
  const recommendedCandidateId = eligibleEvaluations[0]?.candidateId ?? fallback.recommendedCandidateId;
  return { recommendedCandidateId, evaluations, rankingMode: "ai" };
}
