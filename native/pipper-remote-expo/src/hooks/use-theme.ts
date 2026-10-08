import { useColorScheme } from "react-native";

import { Colors, type Theme } from "@/constants/theme";

export function useTheme(): Theme {
  return Colors[useColorScheme() === "dark" ? "dark" : "light"];
}
