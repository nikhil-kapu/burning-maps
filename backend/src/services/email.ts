import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { getConfig } from "../config.js";

type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

let ses: SESv2Client | undefined;

export async function sendEmail(message: EmailMessage): Promise<{ providerId: string }> {
  const config = getConfig();
  if (config.EMAIL_MODE === "console") {
    console.info("Development email", { to: message.to, subject: message.subject, text: message.text });
    return { providerId: `console-email-${Date.now()}` };
  }
  ses ??= new SESv2Client({ region: config.AWS_REGION });
  const result = await ses.send(
    new SendEmailCommand({
      FromEmailAddress: config.SES_FROM_EMAIL,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: message.text, Charset: "UTF-8" },
            ...(message.html ? { Html: { Data: message.html, Charset: "UTF-8" } } : {}),
          },
        },
      },
    }),
  );
  return { providerId: result.MessageId ?? `ses-${Date.now()}` };
}

export async function sendVerificationCode(to: string, displayName: string, code: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Verify your Turtle Maps account",
    text: `Hi ${displayName}, your Turtle Maps verification code is ${code}. It expires in 15 minutes. If you did not request this, you can ignore this email.`,
  });
}

export async function sendPasswordResetCode(to: string, displayName: string, code: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Reset your Turtle Maps password",
    text: `Hi ${displayName}, your Turtle Maps password reset code is ${code}. It expires in 15 minutes. Turtle Maps will never ask you to read this code over the phone.`,
  });
}

export async function sendUsernameReminder(to: string, displayName: string, username: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Your Turtle Maps username",
    text: `Hi ${displayName}, your Turtle Maps username is ${username}. You can also sign in with this email address.`,
  });
}
