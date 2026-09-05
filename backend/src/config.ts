import { z } from "zod";

const optionalUrl = z.string().url().or(z.literal(""));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  APP_ORIGIN: z.string().default("http://localhost:8081"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8080"),
  APP_STORE_URL: optionalUrl.default(""),
  CLERK_PUBLISHABLE_KEY: z.string().default(""),
  CLERK_SECRET_KEY: z.string().default(""),
  APPLE_TEAM_ID: z.string().default(""),
  APPLE_BUNDLE_ID: z.string().default("com.turtlebuddy.app"),
  APPLE_OAUTH_CLIENT_IDS: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_IDS: z.string().default(""),
  DATABASE_URL: z.string().min(1).default("postgres://turtle:turtle@127.0.0.1:5433/turtle_buddy"),
  ACCESS_TOKEN_SECRET: z.string().min(32).default("development-access-token-secret-change-me-now"),
  REFRESH_TOKEN_PEPPER: z.string().min(32).default("development-refresh-token-pepper-change-me"),
  FIELD_ENCRYPTION_KEY: z.string().default(""),
  EMAIL_MODE: z.enum(["console", "ses"]).default("console"),
  AWS_REGION: z.string().default("us-west-2"),
  SES_FROM_EMAIL: z.string().email().default("hello@turtlebuddy.app"),
  PUSH_MODE: z.enum(["console", "expo"]).default("console"),
  ROUTE_UPDATES_MODE: z.enum(["disabled", "google"]).default("disabled"),
  GOOGLE_ROUTES_API_KEY: z.string().default(""),
  AGENT_BRIEF_MODE: z.enum(["deterministic", "openai", "openrouter"]).default("deterministic"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_MODEL: z.string().default(""),
  VOICE_MODE: z.enum(["disabled", "vapi"]).default("disabled"),
  VAPI_PRIVATE_KEY: z.string().default(""),
  VAPI_PHONE_NUMBER_ID: z.string().default(""),
  VAPI_ASSISTANT_ID: z.string().default(""),
  SMS_MODE: z.enum(["disabled", "twilio"]).default("disabled"),
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  TWILIO_FROM_NUMBER: z.string().default(""),
  LOCATION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  EVENT_RETENTION_DAYS: z.coerce.number().int().min(7).max(730).default(90),
  SUPPORT_URL: optionalUrl.default(""),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= schema.parse(process.env);
  if (cached.NODE_ENV === "production") {
    const problems = [
      cached.ACCESS_TOKEN_SECRET.includes("development") ? "ACCESS_TOKEN_SECRET" : null,
      cached.REFRESH_TOKEN_PEPPER.includes("development") ? "REFRESH_TOKEN_PEPPER" : null,
      !cached.FIELD_ENCRYPTION_KEY ? "FIELD_ENCRYPTION_KEY" : null,
      cached.EMAIL_MODE !== "ses" ? "EMAIL_MODE=ses" : null,
      cached.PUSH_MODE !== "expo" ? "PUSH_MODE=expo" : null,
      cached.ROUTE_UPDATES_MODE !== "google" || !cached.GOOGLE_ROUTES_API_KEY ? "Google Routes" : null,
      !isAgentBriefAiLive(cached) ? "AI route-brief interpreter" : null,
      cached.VOICE_MODE !== "vapi" || !cached.VAPI_PRIVATE_KEY || !cached.VAPI_PHONE_NUMBER_ID || !cached.VAPI_ASSISTANT_ID ? "Vapi voice" : null,
      cached.SMS_MODE !== "twilio" || !cached.TWILIO_ACCOUNT_SID || !cached.TWILIO_AUTH_TOKEN || !cached.TWILIO_FROM_NUMBER ? "Twilio SMS" : null,
      !cached.PUBLIC_BASE_URL.startsWith("https://") ? "HTTPS PUBLIC_BASE_URL" : null,
      !cached.APP_STORE_URL.startsWith("https://") ? "HTTPS APP_STORE_URL" : null,
      !cached.CLERK_PUBLISHABLE_KEY || !cached.CLERK_SECRET_KEY ? "Clerk authentication" : null,
      !cached.SUPPORT_URL.startsWith("https://") ? "HTTPS SUPPORT_URL" : null,
    ].filter((value): value is string => Boolean(value));
    if (problems.length) throw new Error(`Production configuration is incomplete: ${problems.join(", ")}.`);
  }
  return cached;
}

export function isAgentBriefAiLive(config: AppConfig = getConfig()): boolean {
  if (config.AGENT_BRIEF_MODE === "openai") return Boolean(config.OPENAI_API_KEY && config.OPENAI_MODEL);
  if (config.AGENT_BRIEF_MODE === "openrouter") return Boolean(config.OPENROUTER_API_KEY && config.OPENROUTER_MODEL);
  return false;
}

export function resetConfigForTests(): void {
  cached = undefined;
}
