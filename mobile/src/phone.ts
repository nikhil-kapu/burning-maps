const NON_DIGITS = /\D/g;

export function usPhoneDigits(value: string): string {
  const digits = value.replace(NON_DIGITS, "");
  const withoutCountryCode = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return withoutCountryCode.slice(0, 10);
}

export function formatUsPhone(value: string): string {
  const digits = usPhoneDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function isCompleteUsPhone(value: string): boolean {
  return usPhoneDigits(value).length === 10;
}

export function toUsE164(value: string): string | null {
  const digits = usPhoneDigits(value);
  return digits.length === 10 ? `+1${digits}` : null;
}

export function normalizeSignInIdentifier(value: string): string {
  const trimmed = value.trim();
  if (!/^[+()\-.\s\d]+$/.test(trimmed)) return trimmed;
  return toUsE164(trimmed) ?? trimmed;
}
