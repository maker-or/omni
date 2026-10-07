import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";

import { Colors } from "@/constants/theme";
import { useAppActive } from "@/hooks/use-polling";
import { remoteSession, useRemoteSession } from "@/remote/session";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const { hydrated, config } = useRemoteSession();
  const paired = !!config?.token;
  const active = useAppActive();

  useEffect(() => {
    void remoteSession.hydrate().finally(() => SplashScreen.hideAsync());
  }, []);

  // Refresh the cached catalog on launch and whenever the app comes forward.
  useEffect(() => {
    if (hydrated && paired && active) void remoteSession.refreshCatalogIfStale();
  }, [hydrated, paired, active]);

  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: Colors[scheme].tint,
      background: Colors[scheme].background,
    },
  };

  if (!hydrated) return null;

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
        <Stack.Protected guard={paired}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="thread/[id]" options={{ title: "Thread" }} />
          <Stack.Screen
            name="sample-task"
            options={{ presentation: "modal", title: "Sample task" }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!paired}>
          <Stack.Screen name="pair" options={{ title: "Pair with your Mac" }} />
          <Stack.Screen
            name="scan"
            options={{ presentation: "modal", title: "Scan pairing code" }}
          />
          <Stack.Screen
            name="confirm-pairing"
            options={{ presentation: "modal", title: "Pair with this laptop?" }}
          />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
