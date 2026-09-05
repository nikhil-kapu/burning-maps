import { randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { getConfig } from "../config.js";
import { getPool } from "../db.js";
import { AppError } from "../http/errors.js";
import { issueSession, type UserRow } from "./auth-service.js";

export type SocialProvider = "apple" | "google";

const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function audiences(provider: SocialProvider): string[] {
  const raw = provider === "apple" ? getConfig().APPLE_OAUTH_CLIENT_IDS : getConfig().GOOGLE_OAUTH_CLIENT_IDS;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (!values.length) throw new AppError(503, "SOCIAL_AUTH_NOT_CONFIGURED", `${provider === "apple" ? "Apple" : "Google"} sign-in is not configured yet.`);
  return values;
}

async function verifiedClaims(provider: SocialProvider, idToken: string, nonce?: string): Promise<JWTPayload> {
  try {
    const result = await jwtVerify(idToken, provider === "apple" ? appleKeys : googleKeys, {
      issuer: provider === "apple" ? "https://appleid.apple.com" : ["accounts.google.com", "https://accounts.google.com"],
      audience: audiences(provider),
      clockTolerance: 10,
    });
    if (!result.payload.sub) throw new Error("Missing subject claim.");
    if (provider === "apple" && nonce && result.payload.nonce !== nonce) throw new Error("Nonce mismatch.");
    return result.payload;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, "SOCIAL_TOKEN_INVALID", "That sign-in could not be verified. Please try again.");
  }
}

function cleanName(value: string | undefined, email: string): string {
  const candidate = value?.trim().replace(/\s+/g, " ");
  if (candidate && candidate.length >= 2) return candidate.slice(0, 60);
  return (email.split("@")[0] || "Traveler").replace(/[._-]+/g, " ").slice(0, 60);
}

function usernameBase(email: string): string {
  const base = email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "traveler";
  return (base.length >= 3 ? base : `user_${base}`).slice(0, 17);
}

export async function socialSignIn(input: {
  provider: SocialProvider;
  idToken: string;
  nonce?: string;
  displayName?: string;
  timezone: string;
  termsAccepted: boolean;
  ageConfirmed: boolean;
}, request: FastifyRequest) {
  const claims = await verifiedClaims(input.provider, input.idToken, input.nonce);
  const subject = claims.sub!;
  const found = await getPool().query<UserRow>(
    `SELECT u.* FROM auth_identities i JOIN users u ON u.id=i.user_id
     WHERE i.provider=$1 AND i.provider_subject=$2 AND u.deleted_at IS NULL`,
    [input.provider, subject],
  );
  if (found.rows[0]) return issueSession(found.rows[0], request);

  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  if (!email || !emailVerified) {
    throw new AppError(400, "SOCIAL_EMAIL_REQUIRED", "This provider did not return a verified email address. Choose email sign-up instead.");
  }
  if (!input.termsAccepted || !input.ageConfirmed) {
    throw new AppError(409, "SOCIAL_SIGNUP_CONSENT_REQUIRED", "Create your account first to accept the Terms and age requirement.");
  }

  const client = await getPool().connect();
  let user: UserRow;
  try {
    await client.query("BEGIN");
    const emailOwner = await client.query("SELECT 1 FROM users WHERE lower(email)=lower($1) AND deleted_at IS NULL", [email]);
    if (emailOwner.rowCount) {
      throw new AppError(409, "ACCOUNT_LINK_REQUIRED", "An account already uses that email. Sign in with email first; provider linking can then be added from Account settings.");
    }
    let username = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      username = `${usernameBase(email)}_${randomBytes(3).toString("hex")}`.slice(0, 24);
      const taken = await client.query("SELECT 1 FROM users WHERE lower(username)=lower($1) AND deleted_at IS NULL", [username]);
      if (!taken.rowCount) break;
    }
    const created = await client.query<UserRow>(
      `INSERT INTO users (email,username,display_name,password_hash,email_verified_at,timezone,terms_accepted_at,age_confirmed_at)
       VALUES ($1,$2,$3,NULL,now(),$4,now(),now()) RETURNING *`,
      [email, username, cleanName(input.displayName ?? (typeof claims.name === "string" ? claims.name : undefined), email), input.timezone],
    );
    user = created.rows[0]!;
    await client.query(
      "INSERT INTO auth_identities (user_id,provider,provider_subject,email) VALUES ($1,$2,$3,$4)",
      [user.id, input.provider, subject, email],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return issueSession(user, request);
}
