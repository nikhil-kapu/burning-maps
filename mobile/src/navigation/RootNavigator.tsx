import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { LoadingView } from "../components/LoadingView";
import { AppButton } from "../components/AppButton";
import { BrandMark } from "../components/BrandMark";
import { Screen } from "../components/Screen";
import { AddContactScreen } from "../screens/contacts/AddContactScreen";
import { SafetyCircleScreen } from "../screens/contacts/SafetyCircleScreen";
import { ForgotPasswordScreen, ForgotUsernameScreen, RecoveryScreen, ResetPasswordScreen } from "../screens/auth/RecoveryScreens";
import { SignInScreen } from "../screens/auth/SignInScreen";
import { SignUpScreen } from "../screens/auth/SignUpScreen";
import { VerifyEmailScreen } from "../screens/auth/VerifyEmailScreen";
import { VerifySignInScreen } from "../screens/auth/VerifySignInScreen";
import { WelcomeScreen } from "../screens/auth/WelcomeScreen";
import { AgeConfirmationScreen } from "../screens/auth/AgeConfirmationScreen";
import { LegalDocumentScreen } from "../screens/auth/LegalDocumentScreen";
import { HomeScreen } from "../screens/home/HomeScreen";
import { ActiveJourneyScreen } from "../screens/journeys/ActiveJourneyScreen";
import { CreateJourneyScreen } from "../screens/journeys/CreateJourneyScreen";
import { JourneyDetailScreen } from "../screens/journeys/JourneyDetailScreen";
import { JourneysScreen } from "../screens/journeys/JourneysScreen";
import { ChangePasswordScreen, DeleteAccountScreen, EditProfileScreen } from "../screens/profile/ProfileForms";
import { ProfileScreen } from "../screens/profile/ProfileScreen";
import { InviteScreen } from "../screens/sharing/InviteScreen";
import { SharedJourneyScreen } from "../screens/sharing/SharedJourneyScreen";
import { colors, spacing, typography } from "../theme";
import type { AppStackParamList, AuthStackParamList, TabParamList } from "../types";

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();
const authPreviewRoute = __DEV__
  ? process.env.EXPO_PUBLIC_AUTH_PREVIEW === "sign-in"
    ? "SignIn"
    : process.env.EXPO_PUBLIC_AUTH_PREVIEW === "sign-up"
      ? "SignUp"
      : undefined
  : undefined;

const icons: Record<keyof TabParamList, keyof typeof Ionicons.glyphMap> = {
  Home: "home",
  Journeys: "navigate",
  Circle: "people",
  Profile: "person-circle",
};

function AuthNavigator() {
  return <AuthStack.Navigator initialRouteName={authPreviewRoute} screenOptions={{ headerShown: false, animation: "slide_from_right" }}><AuthStack.Screen name="Welcome" component={WelcomeScreen} /><AuthStack.Screen name="SignIn" component={SignInScreen} /><AuthStack.Screen name="SignUp" component={SignUpScreen} /><AuthStack.Screen name="VerifyEmail" component={VerifyEmailScreen} /><AuthStack.Screen name="VerifySignIn" component={VerifySignInScreen} /><AuthStack.Screen name="Recovery" component={RecoveryScreen} /><AuthStack.Screen name="ForgotUsername" component={ForgotUsernameScreen} /><AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} /><AuthStack.Screen name="ResetPassword" component={ResetPasswordScreen} /><AuthStack.Screen name="Invite" component={InviteScreen} /><AuthStack.Screen name="Legal" component={LegalDocumentScreen} /></AuthStack.Navigator>;
}

function Tabs() {
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      headerShown: false,
      tabBarHideOnKeyboard: true,
      tabBarActiveTintColor: colors.lime,
      tabBarInactiveTintColor: "#777980",
      tabBarStyle: styles.tabBar,
      tabBarLabelStyle: styles.tabLabel,
      tabBarIcon: ({ color, focused }) => <View style={[styles.tabIcon, focused && styles.tabIconActive]}><Ionicons name={icons[route.name]} size={21} color={color} /></View>,
    })}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: "Map" }} />
      <Tab.Screen name="Journeys" component={JourneysScreen} options={{ tabBarLabel: "Trips" }} />
      <Tab.Screen name="Circle" component={SafetyCircleScreen} options={{ tabBarLabel: "People" }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: "You" }} />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  return (
    <AppStack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.cream }, headerShadowVisible: false, headerTintColor: colors.forest, headerTitleStyle: { fontWeight: "800" }, headerBackTitle: "Back", contentStyle: { backgroundColor: colors.cream }, animation: "slide_from_right" }}>
      <AppStack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <AppStack.Screen name="CreateJourney" component={CreateJourneyScreen} options={{ headerTitle: "" }} />
      <AppStack.Screen name="JourneyDetail" component={JourneyDetailScreen} options={{ title: "Journey plan" }} />
      <AppStack.Screen name="ActiveJourney" component={ActiveJourneyScreen} options={{ headerShown: false, gestureEnabled: false }} />
      <AppStack.Screen name="AddContact" component={AddContactScreen} options={({ route }) => ({ title: route.params?.contact ? "Edit contact" : "Add contact", presentation: "modal" })} />
      <AppStack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: "Personal details" }} />
      <AppStack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: "Change password" }} />
      <AppStack.Screen name="DeleteAccount" component={DeleteAccountScreen} options={{ title: "Delete account" }} />
      <AppStack.Screen name="Invite" component={InviteScreen} options={{ title: "Private invitation" }} />
      <AppStack.Screen name="SharedJourney" component={SharedJourneyScreen} options={{ title: "Shared commute" }} />
      <AppStack.Screen name="Legal" component={LegalDocumentScreen} options={{ headerShown: false }} />
    </AppStack.Navigator>
  );
}

export function RootNavigator() {
  const { status, user, error, retry, signOut } = useAuth();
  if (__DEV__ && process.env.EXPO_PUBLIC_AUTH_PREVIEW === "age") return <AgeConfirmationScreen />;
  if (status === "loading") return <LoadingView />;
  if (status === "error") return <Screen><BrandMark /><View style={styles.syncError}><Text style={typography.hero}>Your account is safe.</Text><Text style={typography.body}>Turtle Maps could not finish connecting your account.</Text>{error && <Text style={styles.syncErrorMessage}>{error}</Text>}<AppButton label="Try again" onPress={retry} /><AppButton label="Use another account" variant="secondary" onPress={() => void signOut()} /></View></Screen>;
  if (status !== "signedIn") return <AuthNavigator />;
  if (!user?.ageConfirmed) return <AgeConfirmationScreen />;
  return <AppNavigator />;
}

const styles = StyleSheet.create({
  tabBar: { height: 80, paddingTop: 8, paddingBottom: 10, backgroundColor: colors.paper, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
  tabLabel: { fontSize: 10, fontWeight: "700", marginTop: 2 },
  tabIcon: { width: 34, height: 30, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabIconActive: { borderBottomColor: colors.lime },
  syncError: { marginTop: 80, gap: spacing.lg },
  syncErrorMessage: { ...typography.small, color: colors.danger },
});
