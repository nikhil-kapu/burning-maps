export type User = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  timezone: string;
  phoneE164: string | null;
  emergencyNumber: string | null;
  hasPassword: boolean;
  ageConfirmed: boolean;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  clerkSessionId?: string;
  user: User;
};

export type SafetyContact = {
  id: string;
  name: string;
  relationship: string;
  phoneE164: string | null;
  email: string | null;
  priority: number;
  channels: Array<"sms" | "email">;
  enabled: boolean;
  createdAt: string;
};

export type JourneyStatus = "planned" | "active" | "overdue" | "ended" | "cancelled";
export type TravelMode = "driving" | "public_transit" | "bus" | "subway" | "train" | "taxi" | "rideshare" | "walking" | "cycling";
export type RouteAnchorSuggestion = {
  query: string;
  purpose: string;
  insertAfterWaypointIndex: number;
  targetProgressPercent: number;
};
export type AgentRouteObjective = {
  label: string;
  summary: string;
  detourBudgetPercent: number;
  rankingCriteria: string[];
  suggestedAnchors: RouteAnchorSuggestion[];
};
export type SelectedRouteWaypoint = {
  label: string;
  latitude: number;
  longitude: number;
  role: "required" | "agent";
  purpose?: string;
};
export type SelectedRouteNavigationStep = {
  instruction: string;
  distanceMeters: number;
  coordinate: { latitude: number; longitude: number };
};
export type SelectedJourneyRoute = {
  candidateId: string;
  label: string;
  rationale: string;
  durationSeconds: number;
  distanceMeters: number;
  waypointLabels: string[];
  routeNames: string[];
  routePolyline?: string;
  routeWaypoints?: SelectedRouteWaypoint[];
  navigationSteps?: SelectedRouteNavigationStep[];
};
export type JourneyPreferences = {
  avoidTolls: boolean;
  avoidHighways: boolean;
  avoidFerries: boolean;
  fewerTransfers: boolean;
  quietRide: boolean;
  scenicRoute?: boolean;
  saferStopsAfterDark?: boolean;
  comfortStopAfterMinutes?: number;
  viaWaypoints?: string[];
  routeObjective?: AgentRouteObjective;
  selectedRoute?: SelectedJourneyRoute;
};

export type RouteCandidateEvidence = {
  candidateId: string;
  profile: "standard" | "preference" | "agent_anchor";
  durationSeconds: number;
  distanceMeters: number;
  routeNames: string[];
  advisoryNotices: string[];
  stepInstructions: string[];
  anchorEvidence: Array<{ label: string; purpose: string }>;
};

export type RouteCandidateRanking = {
  recommendedCandidateId: string;
  evaluations: Array<{ candidateId: string; matchScore: number; rationale: string }>;
  rankingMode: "ai" | "deterministic";
};

export type Journey = {
  id: string;
  title: string;
  originLabel: string | null;
  destinationLabel: string;
  destinationCoordinate: { latitude: number; longitude: number } | null;
  travelMode: TravelMode;
  preferences: JourneyPreferences;
  agentInstructions: string | null;
  companionUpdatesEnabled: boolean;
  companionCallEnabled: boolean;
  updateDelayThresholdMinutes: number;
  routeDurationSeconds: number | null;
  routeDistanceMeters: number | null;
  routeLastCheckedAt: string | null;
  lastCompanionUpdate: string | null;
  lastCompanionUpdateAt: string | null;
  expectedArrivalAt: string;
  checkInIntervalMinutes: number;
  graceMinutes: number;
  voiceCallEnabled: boolean;
  status: JourneyStatus;
  notes: string | null;
  startedAt: string | null;
  endedAt: string | null;
  lastCheckInAt: string | null;
  nextCheckInAt: string | null;
  lastCoarseArea: string | null;
  contactCount: number;
  shareToken: string | null;
  shareUrl: string | null;
  deliveryCapabilities: {
    routeUpdatesLive: boolean;
    pushLive: boolean;
    voiceCallsLive: boolean;
    smsLive: boolean;
    emailLive: boolean;
    publicShareLive: boolean;
    agentBriefAiLive: boolean;
  };
  createdAt: string;
  contacts?: SafetyContact[];
};

export type ShareInvitePreview = {
  travelerName: string;
  title: string;
  destinationLabel: string;
  journeyStatus: JourneyStatus;
  invitationStatus: "pending" | "accepted";
  expiresAt: string;
};

export type SharedJourney = {
  invitationId: string;
  journeyId: string;
  travelerName: string;
  title: string;
  destinationLabel: string;
  travelMode: TravelMode;
  status: JourneyStatus;
  expectedArrivalAt: string;
  startedAt: string | null;
  endedAt: string | null;
  lastCheckInAt: string | null;
  nextCheckInAt: string | null;
  lastCoarseArea: string | null;
  lastAgentUpdate: string | null;
  lastAgentUpdateAt: string | null;
  accessExpiresAt: string;
  permissions: { viewStatus: true; viewCoarseArea: true; controlJourney: false; viewPreciseLocation: false };
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: Array<{ path: string; message: string }>;
  };
};

export type AuthStackParamList = {
  Welcome: undefined;
  SignIn: { identifier?: string } | undefined;
  SignUp: undefined;
  VerifyEmail: { email: string };
  VerifySignIn: { identifier: string; factor: "email" | "phone" };
  Recovery: undefined;
  ForgotUsername: undefined;
  ForgotPassword: undefined;
  ResetPassword: { email: string };
  Invite: { token: string };
  Legal: { document: "terms" | "privacy" };
};

export type AppStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  CreateJourney: {
    initialPrompt?: string;
    initialDestination?: string;
    initialDestinationCoordinate?: { latitude: number; longitude: number };
  } | undefined;
  ActiveJourney: { journeyId: string };
  JourneyDetail: { journeyId: string };
  AddContact: { contact?: SafetyContact } | undefined;
  EditProfile: undefined;
  ChangePassword: undefined;
  DeleteAccount: undefined;
  Invite: { token: string };
  SharedJourney: { journeyId: string };
  Legal: { document: "terms" | "privacy" };
};

export type TabParamList = {
  Home: undefined;
  Journeys: undefined;
  Circle: undefined;
  Profile: undefined;
};
import type { NavigatorScreenParams } from "@react-navigation/native";
