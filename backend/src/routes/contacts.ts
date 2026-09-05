import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "../db.js";
import { authenticate } from "../http/authenticate.js";
import { AppError } from "../http/errors.js";
import { usPhoneE164Schema } from "../phone.js";

type ContactRow = {
  id: string;
  name: string;
  relationship: string;
  phone_e164: string | null;
  email: string | null;
  priority: number;
  channels: string[];
  enabled: boolean;
  created_at: Date;
};

const contactBaseSchema = z.object({
  name: z.string().trim().min(2).max(80),
  relationship: z.string().trim().min(2).max(50),
  phoneE164: usPhoneE164Schema.nullable().optional(),
  email: z.string().email().max(254).nullable().optional(),
  priority: z.number().int().min(1).max(10).default(1),
  channels: z.array(z.enum(["sms", "email"])).min(1).max(2),
  enabled: z.boolean().default(true),
});

const contactSchema = contactBaseSchema
  .refine((value) => Boolean(value.phoneE164 || value.email), { message: "Add a phone number or email address." })
  .refine((value) => !value.channels.includes("sms") || Boolean(value.phoneE164), {
    message: "Add a phone number before selecting text messages.",
    path: ["channels"],
  })
  .refine((value) => !value.channels.includes("email") || Boolean(value.email), {
    message: "Add an email address before selecting email updates.",
    path: ["channels"],
  });

function present(row: ContactRow) {
  return {
    id: row.id,
    name: row.name,
    relationship: row.relationship,
    phoneE164: row.phone_e164,
    email: row.email,
    priority: row.priority,
    channels: row.channels,
    enabled: row.enabled,
    createdAt: row.created_at,
  };
}

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request) => {
    const result = await getPool().query<ContactRow>(
      "SELECT * FROM safety_contacts WHERE user_id = $1 ORDER BY priority, created_at",
      [request.auth.userId],
    );
    return { data: result.rows.map(present) };
  });

  app.post("/", async (request, reply) => {
    const body = contactSchema.parse(request.body);
    const result = await getPool().query<ContactRow>(
      `INSERT INTO safety_contacts (user_id, name, relationship, phone_e164, email, priority, channels, enabled)
       VALUES ($1, $2, $3, $4, lower($5), $6, $7, $8) RETURNING *`,
      [request.auth.userId, body.name, body.relationship, body.phoneE164 ?? null, body.email ?? null, body.priority, body.channels, body.enabled],
    );
    return reply.status(201).send({ data: present(result.rows[0]!) });
  });

  app.patch("/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = contactBaseSchema.partial().refine((value) => Object.keys(value).length > 0).parse(request.body);
    const existing = await getPool().query<ContactRow>("SELECT * FROM safety_contacts WHERE id = $1 AND user_id = $2", [params.id, request.auth.userId]);
    const current = existing.rows[0];
    if (!current) throw new AppError(404, "CONTACT_NOT_FOUND", "That safety contact was not found.");
    const next = {
      name: body.name ?? current.name,
      relationship: body.relationship ?? current.relationship,
      phoneE164: body.phoneE164 !== undefined ? body.phoneE164 : current.phone_e164,
      email: body.email !== undefined ? body.email : current.email,
      priority: body.priority ?? current.priority,
      channels: body.channels ?? current.channels,
      enabled: body.enabled ?? current.enabled,
    };
    if (!next.phoneE164 && !next.email) throw new AppError(400, "CONTACT_DESTINATION_REQUIRED", "Add a phone number or email address.");
    if (next.channels.includes("sms") && !next.phoneE164) {
      throw new AppError(400, "CONTACT_PHONE_REQUIRED", "Add a phone number before selecting text messages.");
    }
    if (next.channels.includes("email") && !next.email) {
      throw new AppError(400, "CONTACT_EMAIL_REQUIRED", "Add an email address before selecting email updates.");
    }
    const result = await getPool().query<ContactRow>(
      `UPDATE safety_contacts SET name=$3, relationship=$4, phone_e164=$5, email=lower($6), priority=$7, channels=$8, enabled=$9, updated_at=now()
       WHERE id=$1 AND user_id=$2 RETURNING *`,
      [params.id, request.auth.userId, next.name, next.relationship, next.phoneE164, next.email, next.priority, next.channels, next.enabled],
    );
    return { data: present(result.rows[0]!) };
  });

  app.delete("/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const active = await getPool().query(
      `SELECT 1 FROM journey_contacts jc JOIN journeys j ON j.id = jc.journey_id
       WHERE jc.contact_id = $1 AND j.user_id = $2 AND j.status IN ('active','overdue') LIMIT 1`,
      [params.id, request.auth.userId],
    );
    if (active.rowCount) throw new AppError(409, "CONTACT_IN_ACTIVE_JOURNEY", "End the active journey before removing this contact.");
    const result = await getPool().query("DELETE FROM safety_contacts WHERE id = $1 AND user_id = $2", [params.id, request.auth.userId]);
    if (!result.rowCount) throw new AppError(404, "CONTACT_NOT_FOUND", "That safety contact was not found.");
    return reply.status(204).send();
  });
}
