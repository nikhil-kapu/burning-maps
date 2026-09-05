import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getConfig } from "../config.js";
import { getPool } from "../db.js";
import { authenticate } from "../http/authenticate.js";
import { AppError } from "../http/errors.js";
import { hashOpaqueToken } from "../security.js";
import { createJourneyInvitations, queueInvitationResend } from "../services/journey-sharing.js";

type InviteRow = {
  id: string;
  journey_id: string;
  sender_user_id: string;
  recipient_phone_e164: string | null;
  recipient_email: string | null;
  recipient_user_id: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: Date;
  traveler_name: string;
  title: string;
  destination_label: string;
  journey_status: string;
};

type SharedJourneyRow = {
  invitation_id: string;
  journey_id: string;
  traveler_name: string;
  title: string;
  destination_label: string;
  travel_mode: string;
  journey_status: string;
  expected_arrival_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  last_check_in_at: Date | null;
  next_check_in_at: Date | null;
  last_coarse_area: string | null;
  last_companion_update: string | null;
  last_companion_update_at: Date | null;
  expires_at: Date;
};

function sharedJourney(row: SharedJourneyRow) {
  return {
    invitationId: row.invitation_id,
    journeyId: row.journey_id,
    travelerName: row.traveler_name,
    title: row.title,
    destinationLabel: row.destination_label,
    travelMode: row.travel_mode,
    status: row.journey_status,
    expectedArrivalAt: row.expected_arrival_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lastCheckInAt: row.last_check_in_at,
    nextCheckInAt: row.next_check_in_at,
    lastCoarseArea: row.last_coarse_area,
    lastAgentUpdate: row.last_companion_update,
    lastAgentUpdateAt: row.last_companion_update_at,
    accessExpiresAt: row.expires_at,
    permissions: { viewStatus: true, viewCoarseArea: true, controlJourney: false, viewPreciseLocation: false },
  };
}

const sharedSelect = `SELECT i.id AS invitation_id,j.id AS journey_id,u.display_name AS traveler_name,
  j.title,j.destination_label,j.travel_mode,j.status AS journey_status,j.expected_arrival_at,j.started_at,j.ended_at,
  j.last_check_in_at,j.next_check_in_at,j.last_coarse_area,j.last_companion_update,j.last_companion_update_at,i.expires_at
  FROM journey_share_invitations i JOIN journeys j ON j.id=i.journey_id JOIN users u ON u.id=i.sender_user_id`;

async function invitationForToken(token: string, lock = false): Promise<InviteRow | null> {
  const result = await getPool().query<InviteRow>(
    `SELECT i.*,u.display_name AS traveler_name,j.title,j.destination_label,j.status AS journey_status
     FROM journey_share_invitations i JOIN users u ON u.id=i.sender_user_id JOIN journeys j ON j.id=i.journey_id
     WHERE i.token_hash=$1 ${lock ? "FOR UPDATE OF i" : ""}`,
    [hashOpaqueToken(token)],
  );
  return result.rows[0] ?? null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

export async function journeySharingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/.well-known/apple-app-site-association", async (_request, reply) => {
    const config = getConfig();
    const details = config.APPLE_TEAM_ID ? [{ appID: `${config.APPLE_TEAM_ID}.${config.APPLE_BUNDLE_ID}`, paths: ["/invite/*"] }] : [];
    return reply.header("Content-Type", "application/json").header("Cache-Control", "public, max-age=3600").send({ applinks: { apps: [], details } });
  });

  app.get("/invite/:token", {
    config: { rateLimit: { max: 30, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const { token } = z.object({ token: z.string().min(32).max(256) }).parse(request.params);
    const invite = await invitationForToken(token);
    const valid = invite && invite.status !== "revoked" && invite.expires_at.getTime() > Date.now();
    const title = valid ? `${escapeHtml(invite.traveler_name)} shared a commute` : "This commute link is unavailable";
    const description = valid ? `Sign in to view the commute to ${escapeHtml(invite.destination_label)}. Exact location and traveler controls stay private.` : "The private invitation has expired, was revoked, or is invalid.";
    const customUrl = `turtlebuddy://invite/${encodeURIComponent(token)}`;
    const fallback = getConfig().APP_STORE_URL || customUrl;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title} · Turtle Maps</title><style>body{margin:0;background:#f7f3e8;color:#173f35;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;min-height:100vh;place-items:center}.card{max-width:430px;margin:24px;padding:34px;border:1px solid #d7dece;border-radius:28px;background:#fff;box-shadow:0 20px 60px #173f3518}.mark{width:52px;height:52px;border-radius:18px;background:#173f35;color:#d8ff6a;display:grid;place-items:center;font-size:25px}h1{font-size:30px;line-height:1.08;margin:24px 0 12px}p{line-height:1.55;color:#52645c}.button{display:block;margin-top:26px;padding:16px 20px;border-radius:16px;background:#173f35;color:#fff;text-align:center;text-decoration:none;font-weight:800}.fine{font-size:13px;margin-top:18px}</style></head><body><main class="card"><div class="mark">↗</div><h1>${title}</h1><p>${description}</p>${valid ? `<a class="button" href="${customUrl}">Open in Turtle Maps</a><p class="fine">New here? The app will let you create an account with Apple, Google, or email before accepting.</p><script>setTimeout(function(){document.querySelector('.button').href=${JSON.stringify(fallback)}},1800)</script>` : ""}</main></body></html>`;
    return reply.header("Content-Type", "text/html; charset=utf-8").header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'").send(html);
  });

  app.get("/v1/share-invites/:token/preview", {
    config: { rateLimit: { max: 30, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const { token } = z.object({ token: z.string().min(32).max(256) }).parse(request.params);
    const invite = await invitationForToken(token);
    if (!invite) throw new AppError(404, "INVITATION_NOT_FOUND", "This private commute invitation is invalid.");
    if (invite.status === "revoked") throw new AppError(410, "INVITATION_REVOKED", "The traveler revoked this invitation.");
    if (invite.expires_at.getTime() <= Date.now()) {
      await getPool().query("UPDATE journey_share_invitations SET status='expired',updated_at=now() WHERE id=$1 AND status='pending'", [invite.id]);
      throw new AppError(410, "INVITATION_EXPIRED", "This private commute invitation has expired.");
    }
    return reply.header("Cache-Control", "no-store").send({ data: {
      travelerName: invite.traveler_name,
      title: invite.title,
      destinationLabel: invite.destination_label,
      journeyStatus: invite.journey_status,
      invitationStatus: invite.status,
      expiresAt: invite.expires_at,
    } });
  });

  app.post("/v1/share-invites/:token/accept", { preHandler: authenticate }, async (request) => {
    const { token } = z.object({ token: z.string().min(32).max(256) }).parse(request.params);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<InviteRow>(
        `SELECT i.*,u.display_name AS traveler_name,j.title,j.destination_label,j.status AS journey_status
         FROM journey_share_invitations i JOIN users u ON u.id=i.sender_user_id JOIN journeys j ON j.id=i.journey_id
         WHERE i.token_hash=$1 FOR UPDATE OF i`,
        [hashOpaqueToken(token)],
      );
      const invite = result.rows[0];
      if (!invite) throw new AppError(404, "INVITATION_NOT_FOUND", "This private commute invitation is invalid.");
      if (invite.status === "revoked") throw new AppError(410, "INVITATION_REVOKED", "The traveler revoked this invitation.");
      if (invite.expires_at.getTime() <= Date.now()) throw new AppError(410, "INVITATION_EXPIRED", "This private commute invitation has expired.");
      if (invite.recipient_user_id && invite.recipient_user_id !== request.auth.userId) {
        throw new AppError(409, "INVITATION_ALREADY_ACCEPTED", "This invitation has already been accepted by another account.");
      }
      if (!invite.recipient_phone_e164 && invite.recipient_email) {
        const user = await client.query<{ email: string }>("SELECT email FROM users WHERE id=$1", [request.auth.userId]);
        if (user.rows[0]?.email.toLowerCase() !== invite.recipient_email.toLowerCase()) {
          throw new AppError(403, "INVITATION_EMAIL_MISMATCH", `Sign in with the email address this invitation was sent to.`);
        }
      }
      await client.query(
        `UPDATE journey_share_invitations SET status='accepted',recipient_user_id=$2,accepted_at=COALESCE(accepted_at,now()),updated_at=now() WHERE id=$1`,
        [invite.id, request.auth.userId],
      );
      await client.query("INSERT INTO journey_events (journey_id,user_id,event_type,payload) VALUES ($1,$2,'share_invitation_accepted',$3)", [invite.journey_id, invite.sender_user_id, JSON.stringify({ invitationId: invite.id })]);
      await client.query("COMMIT");
      return { data: { journeyId: invite.journey_id } };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/v1/shared-journeys", { preHandler: authenticate }, async (request) => {
    const result = await getPool().query<SharedJourneyRow>(
      `${sharedSelect} WHERE i.recipient_user_id=$1 AND i.status='accepted' AND i.expires_at>now()
       ORDER BY CASE WHEN j.status IN ('active','overdue') THEN 0 ELSE 1 END,j.updated_at DESC LIMIT 100`,
      [request.auth.userId],
    );
    return { data: result.rows.map(sharedJourney) };
  });

  app.get("/v1/shared-journeys/:journeyId", { preHandler: authenticate }, async (request) => {
    const { journeyId } = z.object({ journeyId: z.string().uuid() }).parse(request.params);
    const result = await getPool().query<SharedJourneyRow>(
      `${sharedSelect} WHERE i.recipient_user_id=$1 AND i.status='accepted' AND i.expires_at>now() AND j.id=$2`,
      [request.auth.userId, journeyId],
    );
    if (!result.rows[0]) throw new AppError(404, "SHARED_JOURNEY_NOT_FOUND", "This shared commute is no longer available.");
    return { data: sharedJourney(result.rows[0]) };
  });

  app.post("/v1/journeys/:journeyId/share-invites/resend", { preHandler: authenticate }, async (request, reply) => {
    const { journeyId } = z.object({ journeyId: z.string().uuid() }).parse(request.params);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const owner = await client.query<{ phone_e164: string | null; expected_arrival_at: Date }>(
        `SELECT u.phone_e164,j.expected_arrival_at FROM journeys j JOIN users u ON u.id=j.user_id
         WHERE j.id=$1 AND j.user_id=$2 AND j.status IN ('active','overdue')`,
        [journeyId, request.auth.userId],
      );
      if (!owner.rows[0]) throw new AppError(409, "JOURNEY_NOT_ACTIVE", "Only an active journey can be shared again.");
      if (!owner.rows[0].phone_e164) throw new AppError(409, "PHONE_REQUIRED_FOR_SHARING", "Add your phone number before sharing a journey.");
      const invitations = await client.query<{ id: string; contact_id: string | null; channels: string[] }>(
        `SELECT i.id,i.contact_id,c.channels FROM journey_share_invitations i
         LEFT JOIN safety_contacts c ON c.id=i.contact_id WHERE i.journey_id=$1 AND i.sender_user_id=$2 AND i.status<>'revoked' AND i.expires_at>now()`,
        [journeyId, request.auth.userId],
      );
      if (!invitations.rowCount) {
        const recipientCount = await createJourneyInvitations({ client, journeyId, senderUserId: request.auth.userId, expectedArrivalAt: owner.rows[0].expected_arrival_at });
        await client.query("COMMIT");
        return reply.status(202).send({ data: { queued: true, recipientCount } });
      }
      const cycle = new Date().toISOString().slice(0, 16);
      for (const invite of invitations.rows) await queueInvitationResend({ client, invitationId: invite.id, journeyId, senderUserId: request.auth.userId, contactId: invite.contact_id, channels: invite.channels ?? [], cycle });
      await client.query("COMMIT");
      return reply.status(202).send({ data: { queued: true, recipientCount: invitations.rowCount } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete("/v1/share-invites/:invitationId", { preHandler: authenticate }, async (request, reply) => {
    const { invitationId } = z.object({ invitationId: z.string().uuid() }).parse(request.params);
    const result = await getPool().query(
      `UPDATE journey_share_invitations SET status='revoked',revoked_at=now(),recipient_user_id=NULL,updated_at=now()
       WHERE id=$1 AND sender_user_id=$2 AND status<>'revoked' RETURNING id`,
      [invitationId, request.auth.userId],
    );
    if (!result.rowCount) throw new AppError(404, "INVITATION_NOT_FOUND", "That invitation was not found.");
    await getPool().query("UPDATE escalation_actions SET status='cancelled',updated_at=now() WHERE invitation_id=$1 AND status IN ('pending','failed')", [invitationId]);
    return reply.status(204).send();
  });
}
