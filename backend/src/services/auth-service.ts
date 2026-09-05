import type { FastifyRequest } from "fastify";
import type pg from "pg";
import { getConfig } from "../config.js";
import { getPool } from "../db.js";
import type { AuthenticatedUser } from "../domain.js";
import { generateNumericCode, hashCode, hashOpaqueToken, hashPassword, randomToken, stableHash, verifyPassword } from "../security.js";
import { issueAccessToken } from "../tokens.js";
import { sendPasswordResetCode, sendUsernameReminder, sendVerificationCode } from "./email.js";

export type UserRow = {
  id: string;
  username: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  email_verified_at: Date | null;
  timezone: string;
  phone_e164: string | null;
  emergency_number: string | null;
  clerk_user_id?: string | null;
  clerk_password_enabled?: boolean;
  terms_accepted_at?: Date | null;
  age_confirmed_at?: Date | null;
};

export function publicUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    emailVerified: Boolean(row.email_verified_at),
    timezone: row.timezone,
    phoneE164: row.phone_e164,
    emergencyNumber: row.emergency_number,
    hasPassword: Boolean(row.password_hash) || Boolean(row.clerk_password_enabled),
    ageConfirmed: Boolean(row.age_confirmed_at),
  };
}

async function createCode(client: pg.PoolClient, user: UserRow, purpose: "verify_email" | "reset_password"): Promise<string> {
  const code = generateNumericCode();
  await client.query(
    `UPDATE auth_codes SET consumed_at = now()
     WHERE lower(email) = lower($1) AND purpose = $2 AND consumed_at IS NULL`,
    [user.email, purpose],
  );
  await client.query(
    `INSERT INTO auth_codes (user_id, email, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '15 minutes')`,
    [user.id, user.email, purpose, hashCode(user.email, purpose, code)],
  );
  return code;
}

function requestMetadata(request: FastifyRequest): { userAgent: string | null; ipHash: string } {
  return {
    userAgent: request.headers["user-agent"]?.slice(0, 255) ?? null,
    ipHash: stableHash(request.ip),
  };
}

export async function issueSession(user: UserRow, request: FastifyRequest, clerkSessionId?: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  clerkSessionId?: string;
  user: AuthenticatedUser;
}> {
  const refreshToken = randomToken();
  const metadata = requestMetadata(request);
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO sessions (user_id, refresh_token_hash, expires_at, user_agent, ip_hash, clerk_session_id)
     VALUES ($1, $2, now() + interval '30 days', $3, $4, $5)
     RETURNING id`,
    [user.id, hashOpaqueToken(refreshToken), metadata.userAgent, metadata.ipHash, clerkSessionId ?? null],
  );
  const sessionId = result.rows[0]?.id;
  if (!sessionId) throw new Error("Session creation failed.");
  return {
    accessToken: await issueAccessToken({ userId: user.id, sessionId }),
    refreshToken,
    expiresInSeconds: 900,
    ...(clerkSessionId ? { clerkSessionId } : {}),
    user: publicUser(user),
  };
}

export async function signUp(input: {
  email: string;
  username: string;
  displayName: string;
  password: string;
  timezone: string;
}): Promise<{ userId: string; email: string; devCode?: string }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await hashPassword(input.password);
    const result = await client.query<UserRow>(
      `INSERT INTO users (email, username, display_name, password_hash, timezone, terms_accepted_at, age_confirmed_at)
       VALUES (lower($1), lower($2), $3, $4, $5, now(), now())
       RETURNING *`,
      [input.email.trim(), input.username.trim(), input.displayName.trim(), passwordHash, input.timezone],
    );
    const user = result.rows[0];
    if (!user) throw new Error("User creation failed.");
    const code = await createCode(client, user, "verify_email");
    await client.query("COMMIT");
    await sendVerificationCode(user.email, user.display_name, code);
    return {
      userId: user.id,
      email: user.email,
      ...(getConfig().NODE_ENV !== "production" ? { devCode: code } : {}),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function resendVerification(email: string): Promise<{ devCode?: string }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<UserRow>(
      "SELECT * FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL FOR UPDATE",
      [email.trim()],
    );
    const user = result.rows[0];
    if (!user || user.email_verified_at) {
      await client.query("COMMIT");
      return {};
    }
    const code = await createCode(client, user, "verify_email");
    await client.query("COMMIT");
    await sendVerificationCode(user.email, user.display_name, code);
    return getConfig().NODE_ENV !== "production" ? { devCode: code } : {};
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function consumeCode(input: {
  email: string;
  purpose: "verify_email" | "reset_password";
  code: string;
}, client: pg.PoolClient): Promise<UserRow | null> {
  const result = await client.query<{
    id: string;
    user_id: string;
    code_hash: string;
    attempts: number;
  }>(
    `SELECT id, user_id, code_hash, attempts
     FROM auth_codes
     WHERE lower(email) = lower($1) AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [input.email.trim(), input.purpose],
  );
  const record = result.rows[0];
  if (!record || record.attempts >= 5 || record.code_hash !== hashCode(input.email, input.purpose, input.code)) {
    if (record) await client.query("UPDATE auth_codes SET attempts = attempts + 1 WHERE id = $1", [record.id]);
    return null;
  }
  await client.query("UPDATE auth_codes SET consumed_at = now() WHERE id = $1", [record.id]);
  const user = await client.query<UserRow>("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL", [record.user_id]);
  return user.rows[0] ?? null;
}

export async function verifyEmail(email: string, code: string, request: FastifyRequest) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const user = await consumeCode({ email, purpose: "verify_email", code }, client);
    if (!user) {
      await client.query("COMMIT");
      return null;
    }
    await client.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1", [user.id]);
    user.email_verified_at ??= new Date();
    await client.query("COMMIT");
    return issueSession(user, request);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function signIn(identifier: string, password: string, request: FastifyRequest): Promise<{
  result: Awaited<ReturnType<typeof issueSession>> | null;
  reason?: "unverified";
}> {
  const found = await getPool().query<UserRow>(
    `SELECT * FROM users
     WHERE deleted_at IS NULL AND (lower(email) = lower($1) OR lower(username) = lower($1))
     LIMIT 1`,
    [identifier.trim()],
  );
  const user = found.rows[0];
  if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) return { result: null };
  if (!user.email_verified_at) return { result: null, reason: "unverified" };
  return { result: await issueSession(user, request) };
}

export async function rotateRefreshToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  clerkSessionId?: string;
  user: AuthenticatedUser;
} | null> {
  const nextRefreshToken = randomToken();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<UserRow & { session_id: string; clerk_session_id: string | null }>(
      `SELECT u.*, s.id AS session_id, s.clerk_session_id
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL
       FOR UPDATE OF s`,
      [hashOpaqueToken(refreshToken)],
    );
    const user = result.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      "UPDATE sessions SET refresh_token_hash = $1, last_used_at = now() WHERE id = $2",
      [hashOpaqueToken(nextRefreshToken), user.session_id],
    );
    await client.query("COMMIT");
    return {
      accessToken: await issueAccessToken({ userId: user.id, sessionId: user.session_id }),
      refreshToken: nextRefreshToken,
      expiresInSeconds: 900,
      ...(user.clerk_session_id ? { clerkSessionId: user.clerk_session_id } : {}),
      user: publicUser(user),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await getPool().query(
    "UPDATE sessions SET revoked_at = now() WHERE refresh_token_hash = $1 AND revoked_at IS NULL",
    [hashOpaqueToken(refreshToken)],
  );
}

export async function requestUsername(email: string): Promise<void> {
  const result = await getPool().query<UserRow>(
    "SELECT * FROM users WHERE lower(email) = lower($1) AND email_verified_at IS NOT NULL AND deleted_at IS NULL",
    [email.trim()],
  );
  const user = result.rows[0];
  if (user) await sendUsernameReminder(user.email, user.display_name, user.username);
}

export async function requestPasswordReset(email: string): Promise<{ devCode?: string }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<UserRow>(
      "SELECT * FROM users WHERE lower(email) = lower($1) AND email_verified_at IS NOT NULL AND deleted_at IS NULL FOR UPDATE",
      [email.trim()],
    );
    const user = result.rows[0];
    if (!user) {
      await client.query("COMMIT");
      return {};
    }
    const code = await createCode(client, user, "reset_password");
    await client.query("COMMIT");
    await sendPasswordResetCode(user.email, user.display_name, code);
    return getConfig().NODE_ENV !== "production" ? { devCode: code } : {};
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function resetPassword(email: string, code: string, password: string): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const user = await consumeCode({ email, purpose: "reset_password", code }, client);
    if (!user) {
      await client.query("COMMIT");
      return false;
    }
    await client.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [await hashPassword(password), user.id]);
    await client.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [user.id]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
