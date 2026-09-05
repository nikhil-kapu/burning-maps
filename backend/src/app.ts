import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { clerkPlugin } from "@clerk/fastify";
import Fastify from "fastify";
import { getConfig } from "./config.js";
import { healthcheckDatabase } from "./db.js";
import { registerErrorHandler } from "./http/errors.js";
import { authRoutes } from "./routes/auth.js";
import { contactRoutes } from "./routes/contacts.js";
import { journeyRoutes } from "./routes/journeys.js";
import { meRoutes } from "./routes/me.js";
import { publicStatusRoutes } from "./routes/public-status.js";
import { journeySharingRoutes } from "./routes/journey-sharing.js";

export async function buildApp() {
  const config = getConfig();
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "debug",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.body.password",
          "req.body.currentPassword",
          "req.body.newPassword",
          "req.body.refreshToken",
          "req.body.code",
          "req.body.idToken",
          "req.body.nonce",
          "req.body.latitude",
          "req.body.longitude",
          "res.headers['set-cookie']",
        ],
        censor: "[REDACTED]",
      },
    },
    trustProxy: config.NODE_ENV === "production",
    bodyLimit: 128 * 1024,
    requestIdHeader: "x-request-id",
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.NODE_ENV === "production" ? config.APP_ORIGIN.split(",").map((value) => value.trim()) : true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip,
  });
  if (config.CLERK_PUBLISHABLE_KEY && config.CLERK_SECRET_KEY) {
    await app.register(clerkPlugin, {
      publishableKey: config.CLERK_PUBLISHABLE_KEY,
      secretKey: config.CLERK_SECRET_KEY,
    });
  }

  registerErrorHandler(app);

  app.get("/health/live", async () => ({ status: "ok", service: "turtle-maps-api" }));
  app.get("/health/ready", async (_request, reply) => {
    const database = await healthcheckDatabase();
    return reply.status(database ? 200 : 503).send({ status: database ? "ready" : "not-ready", database });
  });

  await app.register(authRoutes, { prefix: "/v1/auth" });
  await app.register(meRoutes, { prefix: "/v1/me" });
  await app.register(contactRoutes, { prefix: "/v1/contacts" });
  await app.register(journeyRoutes, { prefix: "/v1/journeys" });
  await app.register(publicStatusRoutes, { prefix: "/s" });
  await app.register(journeySharingRoutes);

  return app;
}
