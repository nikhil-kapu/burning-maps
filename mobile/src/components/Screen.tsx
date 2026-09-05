import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme";

export function Screen({ children, scroll = true, style, dark = false, safeTop = true }: React.PropsWithChildren<{ scroll?: boolean; style?: ViewStyle; dark?: boolean; safeTop?: boolean }>) {
  const content = scroll ? (
    <ScrollView contentContainerStyle={[styles.content, style]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
  ) : <View style={[styles.content, styles.fill, style]}>{children}</View>;
  return (
    <SafeAreaView style={[styles.safe, dark && styles.dark]} edges={safeTop ? ["top", "left", "right"] : ["left", "right"]}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>{content}</KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  dark: { backgroundColor: colors.forestDeep },
  fill: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: 16, paddingBottom: 42 },
});
