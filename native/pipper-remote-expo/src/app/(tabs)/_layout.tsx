import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useTheme } from "@/hooks/use-theme";

/**
 * Paired shell: Threads and Settings, with New split off as its own trailing
 * "+" (the tab bar's separated search-role slot on iOS 26+).
 */
export default function TabsLayout() {
  const theme = useTheme();
  return (
    <NativeTabs tintColor={theme.tint}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Threads</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.grid.2x2" md="grid_view" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="new" role="search">
        <NativeTabs.Trigger.Label>New</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="plus" md="add" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
