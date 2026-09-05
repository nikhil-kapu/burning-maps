import { createHash } from "node:crypto";
import type { User as ClerkUser } from "@clerk/backend";
import type { FastifyRequest } from "fastify";
import type pg from "pg";
import { getPool } from "../db.js";
import { AppError } from "../http/errors.js";
import { issueSession, type UserRow } from "./auth-service.js";

function normalizedUsername(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const prefixed = /^[a-z0-9]/.test(normalized) ? normalized : `traveler_${normalized}`;
  return (prefixed.length >= 3 ? prefixed : `traveler_${prefixed}`).slice(0, 24);
}

async function availableUsername(client: pg.PoolClient, requested: string | null, email: string, clerkUserId: string): Promise<string> {
  const base = normalizedUsername(requested || email.split("@")[0] || "traveler");
  const suffix = createHash("sha256").update(clerkUserId).digest("hex").slice(0, 7);
  const candidates = [base, `${base.slice(0, 16)}_${suffix}`, `traveler_${suffix}`];
  for (const candidate of candidates) {
    const found = await client.query("SELECT 1 FROM users WHERE lower(username) = lower($1) AND deleted_at IS NULL", [candidate]);
    if (!found.rowCount) return candidate;
  }
  throw new AppError(409, "USERNAME_UNAVAILABLE", "Choose a different username in your account profile.");
}

function verifiedPrimaryEmail(user: ClerkUser): string {
  const primary = user.primaryEmailAddress;
  if (!primary || primary.verification?.status !== "verified") {
    throw new AppError(403, "CLERK_EMAIL_NOT_VERIFIED", "Verify your primary email before continuing.");
  }
  return primary.emailAddress.trim().toLowerCase();
}

function verifiedPrimaryPhone(user: ClerkUser): string | null {
  const primary = user.primaryPhoneNumber;
  return primary?.verification?.status === "verified" ? primary.phoneNumber : null;
}

function initialDisplayName(user: ClerkUser, email: string): string {
  const metadataName = typeof user.unsafeMetadata.displayName === "string" ? user.unsafeMetadata.displayName.trim() : "";
  const profileName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return (metadataName || profileName || user.username || email.split("@")[0] || "Traveler").slice(0, 60);
}

function metadataAgeConfirmed(user: ClerkUser): boolean {
  return user.unsafeMetadata.ageConfirmed === true;
}

export async function exchangeClerkIdentity(input: {
  clerkUser: ClerkUser;
  clerkSessionId: string;
  timezone: string;
  request: FastifyRequest;
}) {
  const email = verifiedPrimaryEmail(input.clerkUser);
  const phone = verifiedPrimaryPhone(input.clerkUser);
  const client = await getPool().connect();
  let user: UserRow;

  try {
    await client.query("BEGIN");
    const existing = await client.query<UserRow>(
      `SELECT * FROM users
       WHERE deleted_at IS NULL AND (clerk_user_id = $1 OR lower(email) = lower($2))
       ORDER BY CASE WHEN clerk_user_id = $1 THEN 0 ELSE 1 END
       LIMIT 1 FOR UPDATE`,
      [input.clerkUser.id, email],
    );
    const found = existing.rows[0];
    if (found?.clerk_user_id && found.clerk_user_id !== input.clerkUser.id) {
      throw new AppError(409, "ACCOUNT_LINK_CONFLICT", "That verified email is already connected to another identity.");
    }

    if (found) {
      const updated = await client.query<UserRow>(
        `UPDATE users SET
           clerk_user_id = $2,
           clerk_password_enabled = $3,
           email_verified_at = COALESCE(email_verified_at, now()),
           phone_e164 = COALESCE(phone_e164, $4),
           terms_accepted_at = COALESCE(terms_accepted_at, now()),
           age_confirmed_at = COALESCE(age_confirmed_at, CASE WHEN $5 THEN now() ELSE NULL END),
           updated_at = now()
         WHERE id = $1 RETURNING *`,
        [found.id, input.clerkUser.id, input.clerkUser.passwordEnabled, phone, metadataAgeConfirmed(input.clerkUser)],
      );
      user = updated.rows[0]!;
    } else {
      const username = await availableUsername(client, input.clerkUser.username, email, input.clerkUser.id);
      const inserted = await client.query<UserRow>(
        `INSERT INTO users
           (email, username, display_name, password_hash, email_verified_at, timezone, phone_e164, clerk_user_id, clerk_password_enabled, terms_accepted_at, age_confirmed_at)
         VALUES ($1, $2, $3, NULL, now(), $4, $5, $6, $7, now(), CASE WHEN $8 THEN now() ELSE NULL END)
         RETURNING *`,
        [email, username, initialDisplayName(input.clerkUser, email), input.timezone, phone, input.clerkUser.id, input.clerkUser.passwordEnabled, metadataAgeConfirmed(input.clerkUser)],
      );
      user = inserted.rows[0]!;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return issueSession(user, input.request, input.clerkSessionId);
}
