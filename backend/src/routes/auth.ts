import { getAuth } from "@clerk/fastify";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getConfig } from "../config.js";
import { AppError } from "../http/errors.js";
import {
  requestPasswordReset,
  requestUsername,
  resendVerification,
  resetPassword,
  revokeRefreshToken,
  rotateRefreshToken,
  signIn,
  signUp,
  verifyEmail,
} from "../services/auth-service.js";
import { exchangeClerkIdentity } from "../services/clerk-auth.js";
import { socialSignIn } from "../services/social-auth.js";

const email = z.string().trim().email().max(254);
const password = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128)
  .regex(/[a-z]/, "Add a lowercase letter.")
  .regex(/[A-Z]/, "Add an uppercase letter.")
  .regex(/[0-9]/, "Add a number.");

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/clerk/exchange", {
    config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
  }, async (request) => {
    const config = getConfig();
    if (!config.CLERK_PUBLISHABLE_KEY || !config.CLERK_SECRET_KEY || !request.clerk) {
      throw new AppError(503, "CLERK_NOT_CONFIGURED", "Authentication is not configured on this server.");
    }
    const auth = getAuth(request, { acceptsToken: "session_token" });
    if (!auth.userId || !auth.sessionId) throw new AppError(401, "CLERK_SESSION_INVALID", "Please sign in again.");
    const body = z.object({
      timezone: z.string().trim().min(3).max(100).default("America/Los_Angeles"),
    }).parse(request.body);
    const clerkUser = await request.clerk.users.getUser(auth.userId);
    return {
      data: await exchangeClerkIdentity({ clerkUser, clerkSessionId: auth.sessionId, timezone: body.timezone, request }),
    };
  });

  app.post("/social", {
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
  }, async (request) => {
    const body = z.object({
      provider: z.enum(["apple", "google"]),
      idToken: z.string().min(100).max(10000),
      nonce: z.string().min(16).max(256).optional(),
      displayName: z.string().trim().min(2).max(60).optional(),
      timezone: z.string().trim().min(3).max(100).default("America/Los_Angeles"),
      termsAccepted: z.boolean().default(false),
      ageConfirmed: z.boolean().default(false),
    }).parse(request.body);
    return { data: await socialSignIn(body, request) };
  });

  app.post("/sign-up", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const body = z.object({
      email,
      username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/),
      displayName: z.string().trim().min(2).max(60),
      password,
      timezone: z.string().trim().min(3).max(100).default("America/Los_Angeles"),
      termsAccepted: z.literal(true),
      ageConfirmed: z.literal(true),
    }).parse(request.body);
    const result = await signUp(body);
    return reply.status(201).send({
      data: {
        verificationRequired: true,
        userId: result.userId,
        email: result.email,
        ...(result.devCode ? { devCode: result.devCode } : {}),
      },
    });
  });

  app.post("/verify-email", {
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
  }, async (request) => {
    const body = z.object({ email, code: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const result = await verifyEmail(body.email, body.code, request);
    if (!result) throw new AppError(400, "INVALID_CODE", "That verification code is invalid or expired.");
    return { data: result };
  });

  app.post("/resend-verification", {
    config: { rateLimit: { max: 3, timeWindow: "15 minutes" } },
  }, async (request) => {
    const body = z.object({ email }).parse(request.body);
    const result = await resendVerification(body.email);
    return { data: { message: "If the account still needs verification, a new code is on its way.", ...result } };
  });

  app.post("/sign-in", {
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
  }, async (request) => {
    const body = z.object({
      identifier: z.string().trim().min(3).max(254),
      password: z.string().min(1).max(128),
    }).parse(request.body);
    const result = await signIn(body.identifier, body.password, request);
    if (result.reason === "unverified") throw new AppError(403, "EMAIL_NOT_VERIFIED", "Verify your email before signing in.");
    if (!result.result) throw new AppError(401, "INVALID_CREDENTIALS", "The username, email, or password is incorrect.");
    return { data: result.result };
  });

  app.post("/refresh", {
    config: { rateLimit: { max: 30, timeWindow: "15 minutes" } },
  }, async (request) => {
    const body = z.object({ refreshToken: z.string().min(32).max(500) }).parse(request.body);
    const result = await rotateRefreshToken(body.refreshToken);
    if (!result) throw new AppError(401, "REFRESH_TOKEN_INVALID", "Please sign in again.");
    return { data: result };
  });

  app.post("/sign-out", async (request, reply) => {
    const body = z.object({ refreshToken: z.string().min(32).max(500) }).parse(request.body);
    await revokeRefreshToken(body.refreshToken);
    return reply.status(204).send();
  });

  app.post("/forgot-username", {
    config: { rateLimit: { max: 3, timeWindow: "30 minutes" } },
  }, async (request) => {
    const body = z.object({ email }).parse(request.body);
    await requestUsername(body.email);
    return { data: { message: "If an account matches that email, its username is on the way." } };
  });

  app.post("/forgot-password", {
    config: { rateLimit: { max: 3, timeWindow: "30 minutes" } },
  }, async (request) => {
    const body = z.object({ email }).parse(request.body);
    const result = await requestPasswordReset(body.email);
    return { data: { message: "If an account matches that email, a reset code is on the way.", ...result } };
  });

  app.post("/reset-password", {
    config: { rateLimit: { max: 8, timeWindow: "30 minutes" } },
  }, async (request) => {
    const body = z.object({ email, code: z.string().regex(/^\d{6}$/), password }).parse(request.body);
    if (!(await resetPassword(body.email, body.code, body.password))) {
      throw new AppError(400, "INVALID_CODE", "That reset code is invalid or expired.");
    }
    return { data: { message: "Your password was changed. Sign in with the new password." } };
  });
}
