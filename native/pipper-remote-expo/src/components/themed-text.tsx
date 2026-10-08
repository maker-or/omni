import { StyleSheet, Text, type TextProps } from "react-native";

import { Fonts, type ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type ThemedTextProps = TextProps & {
  type?: "default" | "title" | "headline" | "footnote" | "caption" | "code";
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = "default", themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  return <Text style={[{ color: theme[themeColor ?? "text"] }, styles[type], style]} {...rest} />;
}

const styles = StyleSheet.create({
  default: { fontSize: 17, lineHeight: 22 },
  title: { fontSize: 34, lineHeight: 41, fontWeight: "700", fontFamily: Fonts.rounded },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600", fontFamily: Fonts.rounded },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
  code: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.mono },
});
