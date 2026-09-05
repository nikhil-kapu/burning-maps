import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "../db.js";
import { authenticate } from "../http/authenticate.js";
import { AppError } from "../http/errors.js";
import { usPhoneE164Schema } from "../phone.js";
import { hashPassword, verifyPassword } from "../security.js";
import { publicUser } from "../services/auth-service.js";

type MeRow = {
  id: string;
  username: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  email_verified_at: Date | null;
  timezone: string;
  phone_e164: string | null;
  emergency_number: string | null;
  clerk_user_id: string | null;
  clerk_password_enabled: boolean;
  terms_accepted_at: Date | null;
  age_confirmed_at: Date | null;
};

const phone = usPhoneE164Schema.nullable();
const emergencyNumber = z.string().regex(/^[0-9+*#]{2,20}$/).nullable();

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request) => {
    const result = await getPool().query<MeRow>("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL", [request.auth.userId]);
    const user = result.rows[0];
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "This account no longer exists.");
    return { data: publicUser(user) };
  });

  app.patch("/", async (request) => {
    const body = z.object({
      displayName: z.string().trim().min(2).max(60).optional(),
      timezone: z.string().trim().min(3).max(100).optional(),
      phoneE164: phone.optional(),
      emergencyNumber: emergencyNumber.optional(),
    }).refine((value) => Object.keys(value).length > 0, "Provide at least one field.").parse(request.body);
    const result = await getPool().query<MeRow>(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         timezone = COALESCE($3, timezone),
         phone_e164 = CASE WHEN $4::boolean THEN $5 ELSE phone_e164 END,
         emergency_number = CASE WHEN $6::boolean THEN $7 ELSE emergency_number END,
         updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [request.auth.userId, body.displayName ?? null, body.timezone ?? null, body.phoneE164 !== undefined, body.phoneE164 ?? null, body.emergencyNumber !== undefined, body.emergencyNumber ?? null],
    );
    const user = result.rows[0];
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "This account no longer exists.");
    return { data: publicUser(user) };
  });

  app.post("/age-confirmation", async (request) => {
    z.object({ ageConfirmed: z.literal(true) }).parse(request.body);
    const result = await getPool().query<MeRow>(
      "UPDATE users SET age_confirmed_at = COALESCE(age_confirmed_at, now()), updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *",
      [request.auth.userId],
    );
    const user = result.rows[0];
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "This account no longer exists.");
    return { data: publicUser(user) };
  });

  app.post("/change-password", async (request) => {
    const body = z.object({
      currentPassword: z.string().min(1).max(128),
      newPassword: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/),
    }).parse(request.body);
    const result = await getPool().query<MeRow>("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL", [request.auth.userId]);
    const user = result.rows[0];
    if (user?.clerk_user_id) {
      throw new AppError(409, "PASSWORD_MANAGED_BY_CLERK", "Use the Turtle Maps security screen to change this password.");
    }
    if (!user || !user.password_hash || !(await verifyPassword(body.currentPassword, user.password_hash))) {
      throw new AppError(403, "PASSWORD_INCORRECT", "Your current password is incorrect.");
    }
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [await hashPassword(body.newPassword), user.id]);
      await client.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [user.id, request.auth.sessionId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { data: { message: "Password changed. Other devices were signed out." } };
  });

  app.post("/password-changed", async (request) => {
    const result = await getPool().query<MeRow>("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL", [request.auth.userId]);
    const user = result.rows[0];
    if (!user?.clerk_user_id) throw new AppError(409, "PASSWORD_NOT_MANAGED_BY_CLERK", "This account does not use Clerk password management.");
    await getPool().query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [user.id, request.auth.sessionId]);
    return { data: { message: "Password changed. Other Turtle Maps sessions were signed out." } };
  });

  app.post("/device-tokens", async (request, reply) => {
    const body = z.object({
      token: z.string().min(10).max(500),
      platform: z.enum(["ios", "android"]),
    }).parse(request.body);
    await getPool().query(
      `INSERT INTO device_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, enabled = true, last_seen_at = now()`,
      [request.auth.userId, body.token, body.platform],
    );
    return reply.status(201).send({ data: { registered: true } });
  });

  app.delete("/device-tokens", async (request, reply) => {
    const body = z.object({ token: z.string().min(10).max(500) }).parse(request.body);
    await getPool().query("UPDATE device_tokens SET enabled = false WHERE user_id = $1 AND token = $2", [request.auth.userId, body.token]);
    return reply.status(204).send();
  });

  app.delete("/", async (request, reply) => {
    const body = z.object({ password: z.string().max(128).default(""), confirmation: z.literal("DELETE") }).parse(request.body);
    const result = await getPool().query<MeRow>("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL", [request.auth.userId]);
    const user = result.rows[0];
    if (!user || (user.password_hash && !(await verifyPassword(body.password, user.password_hash)))) {
      throw new AppError(403, "PASSWORD_INCORRECT", "Your password is incorrect.");
    }
    if (user.clerk_user_id) {
      if (!request.clerk) throw new AppError(503, "CLERK_NOT_CONFIGURED", "Authentication is not configured on this server.");
      await request.clerk.users.deleteUser(user.clerk_user_id);
    }
    await getPool().query("DELETE FROM users WHERE id = $1", [user.id]);
    return reply.status(204).send();
  });
}
