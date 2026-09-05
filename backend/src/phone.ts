import { z } from "zod";

export function normalizeUsPhone(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return value;
}

export const usPhoneE164Schema = z.preprocess(
  normalizeUsPhone,
  z.string().regex(/^\+1\d{10}$/, "Enter a 10-digit US phone number."),
);
