import type { TextStyle, ViewStyle } from "react-native";

export const colors = {
  cream: "#F3F1EB",
  paper: "#FCFBF8",
  forest: "#1D1E1A",
  forestDeep: "#11120F",
  moss: "#65685F",
  accent: "#B64D32",
  accentSoft: "#F1DDD4",
  sage: "#747F6D",
  sageSoft: "#DDE4D8",
  sand: "#EBD8C6",
  mapWash: "#CBD5CA",
  lime: "#B64D32",
  mint: "#DDE4D8",
  coral: "#D77A49",
  peach: "#EBD8C6",
  sky: "#CBD5CA",
  ink: "#191A17",
  textMuted: "#6B6D65",
  line: "#D8D5CD",
  white: "#FFFFFF",
  danger: "#C94738",
  success: "#277A55",
  warning: "#A25B21",
  overlay: "rgba(17,18,15,0.5)",
} as const;

export const radii = {
  small: 12,
  medium: 18,
  large: 26,
  xl: 34,
  pill: 999,
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 44,
} as const;

export const shadow: ViewStyle = {
  shadowColor: colors.forestDeep,
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.08,
  shadowRadius: 22,
  elevation: 3,
};

export const typography: Record<string, TextStyle> = {
  display: { fontSize: 42, lineHeight: 45, fontWeight: "800", letterSpacing: -1.4, color: colors.ink },
  hero: { fontSize: 34, lineHeight: 38, fontWeight: "800", letterSpacing: -0.9, color: colors.ink },
  title: { fontSize: 28, lineHeight: 32, fontWeight: "800", letterSpacing: -0.5, color: colors.ink },
  section: { fontSize: 20, lineHeight: 24, fontWeight: "800", color: colors.ink },
  body: { fontSize: 16, lineHeight: 23, fontWeight: "400", color: colors.ink },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: "700", color: colors.ink },
  small: { fontSize: 13, lineHeight: 18, fontWeight: "500", color: colors.textMuted },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: "800", letterSpacing: 1.4, color: colors.moss },
  button: { fontSize: 16, lineHeight: 20, fontWeight: "800" },
};
