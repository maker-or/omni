import { Platform } from "react-native";

/**
 * Light and dark palettes, matched to the iOS system colors the SwiftUI app
 * uses (systemBackground, secondarySystemBackground, grouped forms, indigo).
 */
export const Colors = {
  light: {
    text: "#000000",
    textSecondary: "#6C6C72",
    background: "#FFFFFF",
    /** Cards and the composer field on a plain background. */
    backgroundElement: "#F2F2F7",
    backgroundSelected: "#E5E5EA",
    /** Form screens: grouped background with raised rows. */
    groupedBackground: "#F2F2F7",
    groupedRow: "#FFFFFF",
    separator: "#C6C6C8",
    tint: "#5856D6",
    onTint: "#FFFFFF",
    danger: "#FF3B30",
    warning: "#C46A00",
    success: "#248A3D",
    disabled: "#C7C7CC",
  },
  dark: {
    text: "#FFFFFF",
    textSecondary: "#98989F",
    background: "#000000",
    backgroundElement: "#1C1C1E",
    backgroundSelected: "#2C2C2E",
    groupedBackground: "#000000",
    groupedRow: "#1C1C1E",
    separator: "#38383A",
    tint: "#5E5CE6",
    onTint: "#FFFFFF",
    danger: "#FF453A",
    warning: "#FF9F0A",
    success: "#30D158",
    disabled: "#3A3A3C",
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type Theme = { [K in ThemeColor]: string };

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    rounded: "normal",
    mono: "monospace",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;
