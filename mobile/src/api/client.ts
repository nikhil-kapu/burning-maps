import * as SecureStore from "expo-secure-store";
import type { ApiErrorBody, AuthSession, Journey, RouteCandidateEvidence, RouteCandidateRanking, SafetyContact, SelectedJourneyRoute, ShareInvitePreview, SharedJourney, TravelMode, User } from "../types";

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const SESSION_KEY = "turtle-buddy.session.v1";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown; auth?: boolean; retry?: boolean };

class ApiClient {
  private session: AuthSession | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  getSession(): AuthSession | null {
    return this.session;
  }

  async restore(): Promise<AuthSession | null> {
    const value = await SecureStore.getItemAsync(SESSION_KEY);
    if (!value) {
      this.session = null;
      return null;
    }
    try {
      this.session = JSON.parse(value) as AuthSession;
      return this.session;
    } catch {
      this.session = null;
      await SecureStore.deleteItemAsync(SESSION_KEY);
      return null;
    }
  }

  async setSession(session: AuthSession | null): Promise<void> {
    this.session = session;
    if (session) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    else await SecureStore.deleteItemAsync(SESSION_KEY);
  }

  private async refresh(): Promise<boolean> {
    if (!this.session?.refreshToken) return false;
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const response = await this.request<AuthSession>("/v1/auth/refresh", {
          method: "POST",
          body: { refreshToken: this.session?.refreshToken },
          auth: false,
          retry: false,
        });
        await this.setSession(response);
        return true;
      } catch {
        await this.setSession(null);
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  private async adoptNewerPersistedSession(): Promise<boolean> {
    const value = await SecureStore.getItemAsync(SESSION_KEY);
    if (!value) return false;
    try {
      const persisted = JSON.parse(value) as AuthSession;
      if (!persisted.accessToken || persisted.accessToken === this.session?.accessToken) return false;
      this.session = persisted;
      return true;
    } catch {
      return false;
    }
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { body, auth = true, retry = true, headers, ...rest } = options;
    const response = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(auth && this.session?.accessToken ? { Authorization: `Bearer ${this.session.accessToken}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401 && auth && retry) {
      const recovered = (await this.adoptNewerPersistedSession()) || (await this.refresh());
      if (recovered) return this.request<T>(path, { ...options, retry: false });
    }
    if (!response.ok) {
      const parsed = (await response.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(parsed?.error.code ?? "NETWORK_ERROR", parsed?.error.message ?? `Request failed with ${response.status}.`, response.status, parsed?.error.details);
    }
    if (response.status === 204) return undefined as T;
    const parsed = (await response.json()) as { data: T };
    return parsed.data;
  }

  signUp(body: { email: string; username: string; displayName: string; password: string; timezone: string; termsAccepted: true; ageConfirmed: true }) {
    return this.request<{ verificationRequired: boolean; userId: string; email: string; devCode?: string }>("/v1/auth/sign-up", { method: "POST", body, auth: false });
  }
  verifyEmail(body: { email: string; code: string }) {
    return this.request<AuthSession>("/v1/auth/verify-email", { method: "POST", body, auth: false });
  }
  resendVerification(email: string) {
    return this.request<{ message: string; devCode?: string }>("/v1/auth/resend-verification", { method: "POST", body: { email }, auth: false });
  }
  signIn(identifier: string, password: string) {
    return this.request<AuthSession>("/v1/auth/sign-in", { method: "POST", body: { identifier, password }, auth: false });
  }
  socialSignIn(body: { provider: "apple" | "google"; idToken: string; nonce?: string; displayName?: string; timezone: string; termsAccepted: boolean; ageConfirmed: boolean }) {
    return this.request<AuthSession>("/v1/auth/social", { method: "POST", body, auth: false });
  }
  clerkExchange(token: string) {
    return this.request<AuthSession>("/v1/auth/clerk/exchange", {
      method: "POST",
      body: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles" },
      auth: false,
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  forgotUsername(email: string) {
    return this.request<{ message: string }>("/v1/auth/forgot-username", { method: "POST", body: { email }, auth: false });
  }
  forgotPassword(email: string) {
    return this.request<{ message: string; devCode?: string }>("/v1/auth/forgot-password", { method: "POST", body: { email }, auth: false });
  }
  resetPassword(email: string, code: string, password: string) {
    return this.request<{ message: string }>("/v1/auth/reset-password", { method: "POST", body: { email, code, password }, auth: false });
  }
  me() { return this.request<User>("/v1/me"); }
  updateMe(body: Partial<{ displayName: string; timezone: string; phoneE164: string | null; emergencyNumber: string | null }>) { return this.request<User>("/v1/me", { method: "PATCH", body }); }
  confirmAge() { return this.request<User>("/v1/me/age-confirmation", { method: "POST", body: { ageConfirmed: true } }); }
  changePassword(currentPassword: string, newPassword: string) { return this.request<{ message: string }>("/v1/me/change-password", { method: "POST", body: { currentPassword, newPassword } }); }
  passwordChanged() { return this.request<{ message: string }>("/v1/me/password-changed", { method: "POST", body: {} }); }
  deleteAccount(password: string) { return this.request<void>("/v1/me", { method: "DELETE", body: { password, confirmation: "DELETE" } }); }
  contacts() { return this.request<SafetyContact[]>("/v1/contacts"); }
  createContact(body: Omit<SafetyContact, "id" | "createdAt">) { return this.request<SafetyContact>("/v1/contacts", { method: "POST", body }); }
  updateContact(id: string, body: Partial<Omit<SafetyContact, "id" | "createdAt">>) { return this.request<SafetyContact>(`/v1/contacts/${id}`, { method: "PATCH", body }); }
  deleteContact(id: string) { return this.request<void>(`/v1/contacts/${id}`, { method: "DELETE" }); }
  journeys(status?: string) { return this.request<Journey[]>(`/v1/journeys${status ? `?status=${encodeURIComponent(status)}` : ""}`); }
  journey(id: string) { return this.request<Journey>(`/v1/journeys/${id}`); }
  createJourney(body: { title: string; originLabel: string | null; destinationLabel: string; destinationCoordinate: { latitude: number; longitude: number }; travelMode: TravelMode; agentInstructions: string | null; companionUpdatesEnabled: boolean; companionCallEnabled: boolean; updateDelayThresholdMinutes: number; expectedArrivalAt: string; checkInIntervalMinutes: number; graceMinutes: number; voiceCallEnabled: boolean; notes: string | null; contactIds: string[] }) { return this.request<Journey>("/v1/journeys", { method: "POST", body }); }
  rankRouteCandidates(id: string, candidates: RouteCandidateEvidence[]) { return this.request<RouteCandidateRanking>(`/v1/journeys/${id}/route-candidates/rank`, { method: "POST", body: { candidates } }); }
  selectJourneyRoute(id: string, selection: SelectedJourneyRoute) { return this.request<Journey>(`/v1/journeys/${id}/route-selection`, { method: "POST", body: selection }); }
  startJourney(id: string) { return this.request<Journey>(`/v1/journeys/${id}/start`, { method: "POST", body: {} }); }
  cancelJourney(id: string) { return this.request<Journey>(`/v1/journeys/${id}/cancel`, { method: "POST", body: {} }); }
  checkIn(id: string, note?: string) { return this.request<Journey>(`/v1/journeys/${id}/check-in`, { method: "POST", body: { note: note ?? null } }); }
  extendJourney(id: string, expectedArrivalAt: string) { return this.request<Journey>(`/v1/journeys/${id}/extend`, { method: "POST", body: { expectedArrivalAt } }); }
  endJourney(id: string) { return this.request<Journey>(`/v1/journeys/${id}/end`, { method: "POST", body: {} }); }
  sendLocation(id: string, body: { latitude: number; longitude: number; accuracyMeters?: number | null; coarseArea?: string | null; recordedAt: string }) { return this.request<{ accepted: boolean }>(`/v1/journeys/${id}/location`, { method: "POST", body }); }
  callMe(id: string, idempotencyKey: string) { return this.request<{ queued: boolean; deliveryMode: "live" | "simulated" }>(`/v1/journeys/${id}/call-me`, { method: "POST", body: { idempotencyKey } }); }
  simulateCompanionUpdate(id: string, idempotencyKey: string, summary?: string) { return this.request<{ queued: boolean; channels: Array<"push" | "voice"> }>(`/v1/journeys/${id}/simulate-companion-update`, { method: "POST", body: { idempotencyKey, ...(summary ? { summary } : {}) } }); }
  alertCircle(id: string, idempotencyKey: string, message?: string) { return this.request<{ queued: boolean; recipientCount: number; deliveryMode: "live" | "mixed" | "simulated" }>(`/v1/journeys/${id}/alert`, { method: "POST", body: { holdConfirmed: true, idempotencyKey, message: message ?? null } }); }
  shareInvitePreview(token: string) { return this.request<ShareInvitePreview>(`/v1/share-invites/${encodeURIComponent(token)}/preview`, { auth: false }); }
  acceptShareInvite(token: string) { return this.request<{ journeyId: string }>(`/v1/share-invites/${encodeURIComponent(token)}/accept`, { method: "POST", body: {} }); }
  sharedJourneys() { return this.request<SharedJourney[]>("/v1/shared-journeys"); }
  sharedJourney(id: string) { return this.request<SharedJourney>(`/v1/shared-journeys/${id}`); }
  resendShareInvites(id: string) { return this.request<{ queued: boolean; recipientCount: number }>(`/v1/journeys/${id}/share-invites/resend`, { method: "POST", body: {} }); }
  revokeShareInvite(invitationId: string) { return this.request<void>(`/v1/share-invites/${invitationId}`, { method: "DELETE" }); }
  registerDevice(token: string, platform: "ios" | "android") { return this.request<{ registered: boolean }>("/v1/me/device-tokens", { method: "POST", body: { token, platform } }); }
  async signOut(): Promise<void> {
    const refreshToken = this.session?.refreshToken;
    await this.setSession(null);
    if (refreshToken) await this.request<void>("/v1/auth/sign-out", { method: "POST", body: { refreshToken }, auth: false }).catch(() => undefined);
  }
}

export const api = new ApiClient();
export { API_URL };
