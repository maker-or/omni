import { Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { Markdown } from "@/components/markdown";
import { SelectSheet } from "@/components/select-sheet";
import { ThemedText } from "@/components/themed-text";
import { Fonts, Spacing } from "@/constants/theme";
import { usePolling } from "@/hooks/use-polling";
import { useTheme } from "@/hooks/use-theme";
import { currentModelName } from "@/remote/catalog";
import { errorMessage, isHttpStatus } from "@/remote/client";
import { remoteSession } from "@/remote/session";
import type { RemoteMessage, RemotePermission, RemoteReport } from "@/remote/types";

/** How close to the end still counts as "following" the transcript. */
const NEAR_BOTTOM = 120;

function countUserMessages(report: RemoteReport | null, text: string): number {
  return (report?.messages ?? []).filter((m) => m.role === "user" && m.text === text).length;
}

/**
 * One thread's transcript (polled every 3s; the laptop holds back
 * in-progress agent text, so replies arrive whole) plus a follow-up box.
 */
export default function ThreadScreen() {
  const theme = useTheme();
  const { id: threadId } = useLocalSearchParams<{ id: string }>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();

  const [report, setReport] = useState<RemoteReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [controlling, setControlling] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [pickingModel, setPickingModel] = useState(false);
  const [draft, setDraft] = useState("");
  /** Live draft for async handlers, whose `draft` is from when they started. */
  const draftRef = useRef("");
  const changeDraft = (text: string) => {
    draftRef.current = text;
    setDraft(text);
  };
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** Optimistic bubble until the transcript includes the message. */
  const [pending, setPending] = useState<{ text: string; known: number } | null>(null);
  /**
   * The Mac answered 404: the thread (or its worktree) was deleted there.
   * Terminal: stop polling and don't offer a follow-up that can't land.
   */
  const [missing, setMissing] = useState(false);

  const scroll = useRef<ScrollView>(null);
  /**
   * Sticky bottom: auto-scroll only while the reader is already at the end,
   * or right after they send. Never yank someone who scrolled up to read.
   */
  const nearBottom = useRef(true);
  const forceScroll = useRef(false);
  const loading = useRef(false);
  /** Skip re-rendering (and re-parsing Markdown) when a poll changed nothing. */
  const lastReport = useRef("");

  const load = async () => {
    const client = remoteSession.client;
    if (!client || loading.current) return;
    loading.current = true;
    try {
      const next = await client.report(threadId);
      const json = JSON.stringify(next);
      if (json !== lastReport.current) {
        lastReport.current = json;
        setReport(next);
      }
      setLoadError(null);
      setPending((p) => {
        if (!p) return p;
        if (next.request?.state === "failed" || next.request?.state === "interrupted") return null;
        return countUserMessages(next, p.text) > p.known ? null : p;
      });
    } catch (e) {
      if (isHttpStatus(e, 404)) setMissing(true);
      else setLoadError(errorMessage(e));
    } finally {
      loading.current = false;
    }
  };
  usePolling(load, 3000, !missing);

  const running = report?.running === true;
  const pendingVisible =
    pending && report && countUserMessages(report, pending.text) <= pending.known
      ? pending.text
      : null;

  const control = async (decision?: { id: string; optionId: string | null }) => {
    const client = remoteSession.client;
    if (!client || controlling) return;
    setControlling(true);
    setSendError(null);
    try {
      if (decision) {
        await client.answer(threadId, decision.id, decision.optionId, decision.optionId === null);
      } else {
        await client.stop(threadId);
      }
    } catch (e) {
      setSendError(errorMessage(e));
    } finally {
      setControlling(false);
    }
    await load();
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    changeDraft("");
    forceScroll.current = true;
    setPending({ text, known: countUserMessages(report, text) });
    try {
      await remoteSession.sendPrompt(threadId, text);
      await load();
    } catch (e) {
      // The field stays editable while sending: put the failed message back
      // only if nothing new was typed, and never overwrite a newer draft.
      const typedSince = draftRef.current.trim().length > 0;
      if (!typedSince) changeDraft(text);
      setPending(null);
      setSendError(typedSince ? `Couldn't send "${text}": ${errorMessage(e)}` : errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  /** Applies to the next turn, so it's locked while the Mac is working. */
  const setModel = async (next: string) => {
    const client = remoteSession.client;
    if (!client || switchingModel || next === report?.model?.current) return;
    setSwitchingModel(true);
    setSendError(null);
    try {
      const model = await client.setModel(threadId, next);
      setReport((r) => (r ? { ...r, model } : r));
    } catch (e) {
      setSendError(errorMessage(e));
    } finally {
      setSwitchingModel(false);
    }
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    nearBottom.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - NEAR_BOTTOM;
  };

  const model = report?.model ?? null;
  const modelLocked = running || switchingModel || controlling;

  if (missing) {
    return (
      <View style={[styles.missing, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: "Thread" }} />
        <Icon ios="trash" android="delete" color={theme.textSecondary} size={40} />
        <ThemedText type="headline">Thread no longer exists</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centerText}>
          It was deleted on your Mac, or its worktree was removed. Start a new thread from the list.
        </ThemedText>
      </View>
    );
  }

  const canSend = draft.trim().length > 0 && !sending && !running;

  return (
    <>
      <Stack.Screen
        options={{
          title: report?.summary ?? "Thread",
          headerRight: model
            ? () => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Model: ${currentModelName(model) ?? "default"}`}
                  disabled={modelLocked}
                  hitSlop={8}
                  onPress={() => setPickingModel(true)}
                  style={styles.modelButton}
                >
                  <ThemedText
                    type="footnote"
                    themeColor={modelLocked ? "textSecondary" : "tint"}
                    numberOfLines={1}
                  >
                    {currentModelName(model) ?? "Model"}
                  </ThemedText>
                  <Icon
                    ios="chevron.up.chevron.down"
                    android="unfold_more"
                    color={modelLocked ? theme.textSecondary : theme.tint}
                    size={11}
                  />
                </Pressable>
              )
            : undefined,
        }}
      />
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: theme.background }]}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
      >
        <ScrollView
          ref={scroll}
          style={styles.flex}
          contentContainerStyle={styles.transcript}
          keyboardDismissMode="interactive"
          onScroll={onScroll}
          scrollEventThrottle={64}
          onContentSizeChange={() => {
            if (!nearBottom.current && !forceScroll.current) return;
            forceScroll.current = false;
            scroll.current?.scrollToEnd({ animated: report !== null });
          }}
        >
          {report ? (
            <>
              {loadError ? (
                <View style={styles.notice}>
                  <ThemedText type="footnote" themeColor="warning">
                    {`Connection lost. Showing the last update. ${loadError}`}
                  </ThemedText>
                  <Pressable onPress={() => void load()}>
                    <ThemedText type="footnote" themeColor="tint">
                      Retry connection
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}
              {report.request?.error ? (
                <ThemedText type="footnote" themeColor="danger">
                  {report.request.error}
                </ThemedText>
              ) : null}
              {(report.permissions ?? []).map((decision) => (
                <DecisionCard
                  key={decision.id}
                  decision={decision}
                  disabled={controlling || loadError !== null}
                  onAnswer={(optionId) => void control({ id: decision.id, optionId })}
                />
              ))}
              {report.messages.map((m, i) => (
                <Bubble key={i} role={m.role} text={m.text} />
              ))}
              {pendingVisible ? (
                <Bubble
                  role="user"
                  text={pendingVisible}
                  footnote={sending ? "Sending…" : "Sent · waiting for Mac…"}
                />
              ) : null}
              {running ? (
                <View style={styles.working}>
                  <ActivityIndicator size="small" />
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Working on your Mac…
                  </ThemedText>
                </View>
              ) : null}
            </>
          ) : (
            <ThemedText themeColor="textSecondary" style={styles.loading}>
              {loadError ?? "Loading…"}
            </ThemedText>
          )}
        </ScrollView>

        <View
          style={[
            styles.composerBar,
            {
              backgroundColor: theme.background,
              borderTopColor: theme.separator,
              paddingBottom: keyboardVisible ? Spacing.two : Math.max(insets.bottom, Spacing.two),
            },
          ]}
        >
          {sendError ? (
            <ThemedText type="footnote" themeColor="danger" style={styles.sendError}>
              {sendError}
            </ThemedText>
          ) : null}
          <View
            style={[
              styles.composer,
              { backgroundColor: theme.backgroundElement, borderColor: theme.separator },
            ]}
          >
            <TextInput
              style={[styles.input, { color: theme.text }]}
              value={draft}
              onChangeText={changeDraft}
              placeholder={running ? "Working on your Mac…" : "Follow up…"}
              placeholderTextColor={theme.textSecondary}
              multiline
            />
            {running ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop this thread"
                disabled={controlling}
                onPress={() => void control()}
                style={[styles.action, { backgroundColor: theme.text }]}
              >
                <Icon ios="stop.fill" android="stop" color={theme.background} size={12} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send follow-up"
                disabled={!canSend}
                onPress={() => void send()}
                style={[styles.action, { backgroundColor: canSend ? theme.tint : theme.disabled }]}
              >
                <Icon
                  ios="arrow.up"
                  android="arrow_upward"
                  color={theme.onTint}
                  size={15}
                  weight="bold"
                />
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
      {model ? (
        <SelectSheet
          visible={pickingModel}
          title="Model"
          options={model.options.map((m) => ({ id: m.id, label: m.name }))}
          selected={model.current ?? ""}
          onSelect={(id) => void setModel(id)}
          onClose={() => setPickingModel(false)}
        />
      ) : null}
    </>
  );
}

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

function DecisionCard({
  decision,
  disabled,
  onAnswer,
}: {
  decision: RemotePermission;
  disabled: boolean;
  /** An offered option, or null to dismiss the request. */
  onAnswer: (optionId: string | null) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.decision, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="headline">{decision.title}</ThemedText>
      {decision.detail ? (
        <ThemedText type="code" selectable>
          {decision.detail}
        </ThemedText>
      ) : null}
      {decision.options.map((option) => (
        <Pressable
          key={option.optionId}
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => onAnswer(option.optionId)}
          style={[styles.option, { backgroundColor: theme.backgroundSelected }]}
        >
          <ThemedText themeColor={disabled ? "textSecondary" : "tint"} style={styles.optionText}>
            {option.name}
          </ThemedText>
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onAnswer(null)}>
        <ThemedText themeColor={disabled ? "textSecondary" : "danger"}>Dismiss request</ThemedText>
      </Pressable>
    </View>
  );
}

function Bubble({
  role,
  text,
  footnote,
}: {
  role: RemoteMessage["role"];
  text: string;
  footnote?: string;
}) {
  const theme = useTheme();
  if (role === "agent") {
    return (
      <View style={styles.agent}>
        <Markdown text={text} />
      </View>
    );
  }
  return (
    <View style={styles.userRow}>
      <View style={[styles.userBubble, { backgroundColor: theme.tint }]}>
        <ThemedText themeColor="onTint" selectable>
          {text}
        </ThemedText>
      </View>
      {footnote ? (
        <ThemedText type="caption" themeColor="textSecondary">
          {footnote}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  transcript: { padding: 12, gap: 10 },
  loading: { padding: Spacing.three },
  notice: { gap: Spacing.one },
  working: { flexDirection: "row", alignItems: "center", gap: Spacing.two, paddingHorizontal: 4 },
  missing: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    padding: Spacing.four,
  },
  centerText: { textAlign: "center" },
  modelButton: { flexDirection: "row", alignItems: "center", gap: 3, maxWidth: 160 },
  decision: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  option: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, alignSelf: "flex-start" },
  optionText: { fontWeight: "600" },
  agent: { paddingHorizontal: 4 },
  userRow: { alignItems: "flex-end", gap: 3, paddingLeft: 40 },
  userBubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  composerBar: {
    paddingHorizontal: 12,
    paddingTop: Spacing.two,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sendError: { paddingHorizontal: 4 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 22,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: Spacing.three,
    padding: 5,
    gap: 6,
  },
  input: {
    flex: 1,
    fontSize: 17,
    fontFamily: Fonts.sans,
    maxHeight: 140,
    paddingTop: 7,
    paddingBottom: 7,
  },
  action: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
