import { useMemo } from "react";
import { Linking, StyleSheet } from "react-native";
import MarkdownDisplay from "react-native-markdown-display";

import { Fonts, type Theme } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Agent replies are full Markdown (headings, lists, code, tables) and get
 * the whole width, with no bubble, so wide blocks have room.
 */
export function Markdown({ text }: { text: string }) {
  const theme = useTheme();
  const style = useMemo(() => markdownStyles(theme), [theme]);
  return (
    <MarkdownDisplay
      style={style}
      onLinkPress={(url) => {
        // Only web links leave the app; never act on other schemes from agent text.
        if (/^https?:\/\//i.test(url)) void Linking.openURL(url);
        return false;
      }}
    >
      {text}
    </MarkdownDisplay>
  );
}

function markdownStyles(theme: Theme) {
  const code = { fontFamily: Fonts.mono, fontSize: 13, color: theme.text };
  return StyleSheet.create({
    body: { color: theme.text, fontSize: 16, lineHeight: 22 },
    heading1: { fontSize: 24, lineHeight: 30, fontWeight: "700", marginTop: 8, marginBottom: 4 },
    heading2: { fontSize: 20, lineHeight: 26, fontWeight: "700", marginTop: 8, marginBottom: 4 },
    heading3: { fontSize: 17, lineHeight: 22, fontWeight: "600", marginTop: 6, marginBottom: 2 },
    paragraph: { marginTop: 4, marginBottom: 4 },
    link: { color: theme.tint },
    blockquote: {
      backgroundColor: theme.backgroundElement,
      borderLeftColor: theme.separator,
      borderLeftWidth: 3,
      paddingHorizontal: 10,
      marginVertical: 4,
    },
    code_inline: {
      ...code,
      backgroundColor: theme.backgroundElement,
      borderRadius: 4,
      paddingHorizontal: 4,
    },
    code_block: {
      ...code,
      backgroundColor: theme.backgroundElement,
      borderRadius: 10,
      padding: 10,
      borderWidth: 0,
    },
    fence: {
      ...code,
      backgroundColor: theme.backgroundElement,
      borderRadius: 10,
      padding: 10,
      borderWidth: 0,
    },
    hr: { backgroundColor: theme.separator, height: StyleSheet.hairlineWidth, marginVertical: 8 },
    table: { borderColor: theme.separator, borderWidth: StyleSheet.hairlineWidth, borderRadius: 6 },
    thead: { backgroundColor: theme.backgroundElement },
    th: { padding: 6, fontWeight: "600" },
    tr: { borderColor: theme.separator, borderBottomWidth: StyleSheet.hairlineWidth },
    td: { padding: 6 },
    bullet_list_icon: { color: theme.textSecondary },
    ordered_list_icon: { color: theme.textSecondary },
  });
}
