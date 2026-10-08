import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { SelectSheet } from "@/components/select-sheet";
import { ThemedText } from "@/components/themed-text";
import { Fonts, Spacing } from "@/constants/theme";
import { usePolling } from "@/hooks/use-polling";
import { useTheme } from "@/hooks/use-theme";
import { projectName } from "@/remote/catalog";
import { errorMessage } from "@/remote/client";
import { relativeTime } from "@/remote/format";
import { remoteSession, useRemoteSession } from "@/remote/session";
import type { RemoteConfig, RemoteThreadSummary } from "@/remote/types";

/**
 * Home: one project's threads on the Mac (polled) as a staggered card grid.
 * The large title is the project picker.
 */
export default function ThreadsScreen() {
  const theme = useTheme();
  const { catalog, homeProjectId, config } = useRemoteSession();
  const [threads, setThreads] = useState<RemoteThreadSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState(false);

  const load = async () => {
    const client = remoteSession.client;
    if (!client) return;
    try {
      setThreads(await client.listThreads());
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  };
  usePolling(load, 5000);

  // Newest first; the Mac's order isn't guaranteed to be by recency.
  const sorted = [...threads].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  // Catalog projects, plus any a thread references that the catalog doesn't
  // list yet, ordered by most recent activity.
  const ids: string[] = [];
  for (const t of sorted) if (!ids.includes(t.projectId)) ids.push(t.projectId);
  for (const p of catalog.projects) if (!ids.includes(p.id)) ids.push(p.id);
  const choices = ids.map((id) => ({ id, label: projectName(catalog, id) ?? id }));
  // The stored choice while it still exists, else the most active project.
  const selected = choices.some((c) => c.id === homeProjectId)
    ? homeProjectId
    : (choices[0]?.id ?? "");
  const selectedName = choices.find((c) => c.id === selected)?.label ?? null;
  const visible = sorted.filter((t) => t.projectId === selected);
  // Share the resolved choice so New preselects the project shown here.
  useEffect(() => remoteSession.setShownProjectId(selected), [selected]);

  return (
    <SafeAreaView edges={["top"]} style={[styles.flex, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.header}>
          <Avatar config={config} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Project: ${selectedName ?? "none"}. Switch project`}
            disabled={choices.length < 2}
            onPress={() => setPicking(true)}
            style={styles.projectButton}
          >
            <ThemedText type="title" numberOfLines={1} style={styles.projectTitle}>
              {selectedName ?? "Pipper"}
            </ThemedText>
            {choices.length >= 2 ? (
              <Icon
                ios="chevron.up.chevron.down"
                android="unfold_more"
                color={theme.textSecondary}
                size={18}
                weight="semibold"
              />
            ) : null}
          </Pressable>
        </View>
        {loadError ? (
          <ThemedText type="footnote" themeColor="danger">
            {loadError}
          </ThemedText>
        ) : null}
        {visible.length === 0 && !loadError ? (
          <View style={styles.empty}>
            <Icon
              ios="bubble.left.and.text.bubble.right"
              android="forum"
              color={theme.textSecondary}
              size={44}
            />
            <ThemedText type="headline">No threads yet</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.center}>
              {`Tap + to start a thread in ${selectedName ?? "your project"}.`}
            </ThemedText>
          </View>
        ) : (
          <ThreadGrid threads={visible} />
        )}
      </ScrollView>
      <SelectSheet
        visible={picking}
        title="Project"
        options={choices}
        selected={selected}
        onSelect={(id) => remoteSession.setHomeProjectId(id)}
        onClose={() => setPicking(false)}
      />
    </SafeAreaView>
  );
}

/** Initials of the Mac's verified owner, else of the Mac itself. */
function Avatar({ config }: { config: RemoteConfig | null }) {
  const theme = useTheme();
  const source = config?.owner?.name ?? config?.owner?.email ?? config?.laptopName ?? "Pipper";
  const initials =
    source
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "P";
  return (
    <View accessibilityLabel="Profile" style={[styles.avatar, { backgroundColor: theme.tint }]}>
      <ThemedText themeColor="onTint" style={styles.avatarText}>
        {initials}
      </ThemedText>
    </View>
  );
}

/**
 * Two columns of equal cards; the right column starts lower so the grid
 * reads as staggered. Threads fill left, right, left… in recency order.
 */
function ThreadGrid({ threads }: { threads: RemoteThreadSummary[] }) {
  const left = threads.filter((_, i) => i % 2 === 0);
  const right = threads.filter((_, i) => i % 2 === 1);
  return (
    <View style={styles.grid}>
      <View style={styles.column}>
        {left.map((t) => (
          <ThreadCard key={t.id} thread={t} />
        ))}
      </View>
      <View style={[styles.column, styles.staggered]}>
        {right.map((t) => (
          <ThreadCard key={t.id} thread={t} />
        ))}
      </View>
    </View>
  );
}

function ThreadCard({ thread }: { thread: RemoteThreadSummary }) {
  const theme = useTheme();
  const subtitle = [
    thread.running ? "Running" : relativeTime(thread.lastUsedAt),
    ...(thread.worktreePath === null ? ["project root"] : []),
  ].join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/thread/[id]", params: { id: thread.id } })}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}
    >
      <ThemedText type="headline" numberOfLines={5} style={styles.center}>
        {thread.title ?? thread.id.slice(0, 8)}
      </ThemedText>
      <ThemedText
        type="caption"
        themeColor={thread.running ? "success" : "textSecondary"}
        numberOfLines={2}
        style={styles.center}
      >
        {subtitle}
      </ThemedText>
    </Pressable>
  );
}

const GAP = 14;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.three },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: Spacing.one },
  projectButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  projectTitle: { flexShrink: 1, fontFamily: Fonts.rounded },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 15, fontWeight: "600" },
  empty: {
    alignItems: "center",
    gap: Spacing.two,
    paddingTop: 60,
    paddingHorizontal: Spacing.four,
  },
  center: { textAlign: "center" },
  grid: { flexDirection: "row", alignItems: "flex-start", gap: GAP },
  column: { flex: 1, gap: GAP },
  staggered: { paddingTop: 36 },
  card: {
    height: 200,
    borderRadius: 28,
    borderCurve: "continuous",
    padding: 14,
    justifyContent: "space-between",
  },
});
