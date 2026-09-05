import type pg from "pg";
import { encryptPrivateText, hashOpaqueToken, randomToken } from "../security.js";

type ShareContact = {
  id: string;
  name: string;
  phone_e164: string | null;
  email: string | null;
  channels: string[];
};

export async function createJourneyInvitations(input: {
  client: pg.PoolClient;
  journeyId: string;
  senderUserId: string;
  expectedArrivalAt: Date;
}): Promise<number> {
  const contacts = await input.client.query<ShareContact>(
    `SELECT c.id,c.name,c.phone_e164,c.email,c.channels
     FROM safety_contacts c JOIN journey_contacts jc ON jc.contact_id=c.id
     WHERE jc.journey_id=$1 AND c.enabled=true ORDER BY c.priority`,
    [input.journeyId],
  );
  for (const contact of contacts.rows) {
    const token = randomToken(32);
    const invitation = await input.client.query<{ id: string }>(
      `INSERT INTO journey_share_invitations
         (journey_id,sender_user_id,contact_id,recipient_name,recipient_phone_e164,recipient_email,token_hash,token_ciphertext,expires_at)
       VALUES ($1,$2,$3,$4,$5,lower($6),$7,$8,$9::timestamptz + interval '7 days')
       ON CONFLICT (journey_id,contact_id) DO UPDATE SET
         recipient_name=EXCLUDED.recipient_name,recipient_phone_e164=EXCLUDED.recipient_phone_e164,
         recipient_email=EXCLUDED.recipient_email,token_hash=EXCLUDED.token_hash,token_ciphertext=EXCLUDED.token_ciphertext,
         status='pending',recipient_user_id=NULL,accepted_at=NULL,revoked_at=NULL,expires_at=EXCLUDED.expires_at,updated_at=now()
       RETURNING id`,
      [input.journeyId, input.senderUserId, contact.id, contact.name, contact.phone_e164, contact.email, hashOpaqueToken(token), encryptPrivateText(token), input.expectedArrivalAt],
    );
    for (const channel of contact.channels) {
      if ((channel === "sms" && contact.phone_e164) || (channel === "email" && contact.email)) {
        await input.client.query(
          `INSERT INTO escalation_actions (journey_id,user_id,contact_id,invitation_id,stage,channel,idempotency_key)
           VALUES ($1,$2,$3,$4,'journey_share',$5,$6) ON CONFLICT (idempotency_key) DO NOTHING`,
          [input.journeyId, input.senderUserId, contact.id, invitation.rows[0]!.id, channel, `journey-share:${invitation.rows[0]!.id}:${channel}`],
        );
      }
    }
  }
  return contacts.rowCount ?? 0;
}

export async function queueInvitationResend(input: {
  client: pg.PoolClient;
  invitationId: string;
  journeyId: string;
  senderUserId: string;
  contactId: string | null;
  channels: string[];
  cycle: string;
}): Promise<void> {
  for (const channel of input.channels) {
    if (channel !== "sms" && channel !== "email") continue;
    await input.client.query(
      `INSERT INTO escalation_actions (journey_id,user_id,contact_id,invitation_id,stage,channel,idempotency_key)
       VALUES ($1,$2,$3,$4,'journey_share',$5,$6) ON CONFLICT (idempotency_key) DO NOTHING`,
      [input.journeyId, input.senderUserId, input.contactId, input.invitationId, channel, `journey-share-resend:${input.invitationId}:${input.cycle}:${channel}`],
    );
  }
}
