import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { createNavigationContainerRef, NavigationContainer, type LinkingOptions } from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { LogBox, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/auth/AuthContext";
import "./src/location/background";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { getPendingInvite } from "./src/auth/pendingInvite";
import type { AppStackParamList, AuthStackParamList } from "./src/types";

const universalLinkOrigin = process.env.EXPO_PUBLIC_UNIVERSAL_LINK_ORIGIN;
const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (__DEV__) {
  LogBox.ignoreLogs(["Clerk: Clerk has been loaded with development keys."]);
}

type RootParamList = AppStackParamList & AuthStackParamList;

const linking: LinkingOptions<RootParamList> = {
  prefixes: ["turtlebuddy://", ...(universalLinkOrigin && !/REPLACE|YOUR_/i.test(universalLinkOrigin) ? [universalLinkOrigin] : [])],
  config: {
    screens: {
      Tabs: {
        screens: {
          Home: "home",
          Journeys: "journeys",
          Circle: "circle",
          Profile: "profile",
        },
      },
      ActiveJourney: "journeys/:journeyId/active",
      JourneyDetail: "journeys/:journeyId",
      CreateJourney: "journeys/new",
      Invite: "invite/:token",
      SharedJourney: "shared/:journeyId",
      SignIn: "sign-in",
      SignUp: "sign-up",
      Legal: "legal/:document",
    },
  },
};

const navigationRef = createNavigationContainerRef<RootParamList>();
const handledNotificationIds = new Set<string>();

function openNotification(response: Notifications.NotificationResponse): void {
  const request = response.notification.request;
  if (handledNotificationIds.has(request.identifier) || !navigationRef.isReady()) return;
  const journeyId = request.content.data?.journeyId;
  if (typeof journeyId !== "string" || !journeyId) return;
  handledNotificationIds.add(request.identifier);
  navigationRef.navigate("ActiveJourney", { journeyId });
}

function NotificationNavigationHandler() {
  const { status } = useAuth();
  useEffect(() => {
    if (status !== "signedIn") return;
    const subscription = Notifications.addNotificationResponseReceivedListener(openNotification);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) openNotification(response);
    });
    return () => subscription.remove();
  }, [status]);
  return null;
}

function PendingInviteHandler() {
  const { status } = useAuth();
  useEffect(() => {
    if (status !== "signedIn") return;
    void getPendingInvite().then((token) => {
      if (token && navigationRef.isReady()) navigationRef.navigate("Invite", { token });
    });
  }, [status]);
  return null;
}

export default function App() {
  if (!clerkPublishableKey) throw new Error("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required.");
  return (
    <ClerkProvider publishableKey={clerkPublishableKey} tokenCache={tokenCache}>
      <SafeAreaProvider>
        <AuthProvider>
          <NavigationContainer ref={navigationRef} linking={linking}>
            <StatusBar style={Platform.OS === "ios" ? "dark" : "auto"} />
            <NotificationNavigationHandler />
            <PendingInviteHandler />
            <RootNavigator />
          </NavigationContainer>
        </AuthProvider>
      </SafeAreaProvider>
    </ClerkProvider>
  );
}
