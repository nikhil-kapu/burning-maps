export function clerkErrorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object") {
    const error = value as { longMessage?: string; message?: string; errors?: Array<{ longMessage?: string; message?: string }> };
    const nested = error.errors?.[0];
    return nested?.longMessage || nested?.message || error.longMessage || error.message || fallback;
  }
  return fallback;
}

export function throwClerkError(error: unknown, fallback: string): void {
  if (error) throw new Error(clerkErrorMessage(error, fallback));
}
