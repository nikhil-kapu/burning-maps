import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthContext } from "../domain.js";
import { verifyAccessToken } from "../tokens.js";
import { AppError } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) throw new AppError(401, "AUTH_REQUIRED", "Please sign in to continue.");
  try {
    request.auth = await verifyAccessToken(value.slice(7));
  } catch {
    throw new AppError(401, "SESSION_EXPIRED", "Your session expired. Please sign in again.");
  }
}

