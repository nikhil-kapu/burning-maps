import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Please check the highlighted information.",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
      });
    }
    if ((error as { code?: string }).code === "23505") {
      return reply.status(409).send({ error: { code: "ALREADY_EXISTS", message: "That value is already in use." } });
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
  });
}

