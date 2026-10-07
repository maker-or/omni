import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";

import { ButtonRow, Form, LabeledRow, Row, Section, StatusRow } from "@/components/form";
import { PickerRow } from "@/components/select-sheet";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { availableAgents, preferredAgent } from "@/remote/catalog";
import { errorMessage } from "@/remote/client";
import { remoteSession, useRemoteSession } from "@/remote/session";
import type { RemoteThreadSummary } from "@/remote/types";

const SAMPLE_PROMPT =
  "Describe this project's purpose in one sentence. Do not change files or run commands.";

/**
 * Manual equivalent of the iOS Siri intent: pick project + agent (+ model),
 * type a task. Used by the New tab and the connection check's sample task.
 */
export function NewThreadForm({
  onCreated,
  initialProjectId,
  sampleTask = false,
  title,
}: {
  onCreated: (thread: RemoteThreadSummary) => void;
  /** Preselected project (the one shown on Home); null picks the first. */
  initialProjectId?: string | null;
  sampleTask?: boolean;
  title: string;
}) {
  const theme = useTheme();
  const session = useRemoteSession();
  const { catalog, agentModels, loadingAgentModels, agentModelsSupported, agentModelsError } =
    session;
  const [projectId, setProjectId] = useState("");
  const [agentId, setAgentId] = useState("");
  /** Model inside the agent; "" keeps the agent's default. */
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState(sampleTask ? SAMPLE_PROMPT : "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void remoteSession.refreshCatalogIfStale();
    void remoteSession.refreshAgentModels();
  }, []);

  // Default the project once the catalog is known; keep a user's choice.
  const projects = catalog.projects;
  const effectiveProjectId =
    projectId && projects.some((p) => p.id === projectId)
      ? projectId
      : (projects.find((p) => p.id === initialProjectId)?.id ?? projects[0]?.id ?? "");
  const effectiveAgentId = agentId || preferredAgent(catalog)?.id || null;
  const models = (effectiveAgentId && agentModels[effectiveAgentId]) || [];
  const canStart = !!effectiveProjectId && prompt.trim().length > 0 && !sending;

  const start = async () => {
    if (!canStart) return;
    setSending(true);
    setError(null);
    try {
      const thread = await remoteSession.createThread({
        projectId: effectiveProjectId,
        agentId: effectiveAgentId,
        model: model || null,
        prompt: prompt.trim(),
      });
      if (!sampleTask) setPrompt("");
      onCreated(thread);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () =>
            sending ? (
              <ActivityIndicator />
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={!canStart}
                hitSlop={12}
                onPress={() => void start()}
              >
                <ThemedText themeColor={canStart ? "tint" : "textSecondary"} style={styles.start}>
                  Start
                </ThemedText>
              </Pressable>
            ),
        }}
      />
      <Form>
        <Section
          footer={
            !agentModelsSupported ? (
              "Update Pipper on your Mac to choose a model."
            ) : agentModelsError && models.length === 0 ? (
              <View style={styles.footer}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {`Couldn't load models: ${agentModelsError}`}
                </ThemedText>
                <Pressable onPress={() => void remoteSession.refreshAgentModels()}>
                  <ThemedText type="footnote" themeColor="tint">
                    Retry
                  </ThemedText>
                </Pressable>
              </View>
            ) : undefined
          }
        >
          <PickerRow
            label="Project"
            selected={effectiveProjectId}
            onSelect={setProjectId}
            options={projects.map((p) => ({ id: p.id, label: p.name, detail: p.path }))}
          />
          <PickerRow
            label="Agent"
            selected={agentId}
            onSelect={(id) => {
              setAgentId(id);
              setModel("");
            }}
            options={[
              { id: "", label: "Mac default" },
              ...availableAgents(catalog).map((a) => ({ id: a.id, label: a.displayName })),
            ]}
          />
          {models.length > 0 ? (
            <PickerRow
              label="Model"
              selected={model}
              onSelect={setModel}
              options={[
                { id: "", label: "Agent default" },
                ...models.map((m) => ({ id: m.id, label: m.name })),
              ]}
            />
          ) : (
            <LabeledRow
              label="Model"
              value="Agent default"
              accessory={loadingAgentModels ? <ActivityIndicator /> : undefined}
            />
          )}
        </Section>
        <Section header="Task">
          <Row>
            <TextInput
              style={[styles.prompt, { color: theme.text }]}
              value={prompt}
              onChangeText={setPrompt}
              placeholder="What should the agent do?"
              placeholderTextColor={theme.textSecondary}
              multiline
            />
          </Row>
        </Section>
        {error ? (
          <Section>
            <StatusRow text={error} color="danger" />
          </Section>
        ) : null}
        {projects.length === 0 ? (
          <Section>
            <StatusRow
              text={session.catalogError ?? "No projects loaded from the Mac yet."}
              color="textSecondary"
            />
            <ButtonRow
              title="Refresh catalog"
              onPress={() => void remoteSession.refreshCatalog()}
            />
          </Section>
        ) : null}
      </Form>
    </>
  );
}

const styles = StyleSheet.create({
  start: { fontWeight: "600" },
  footer: { gap: Spacing.one },
  prompt: { flex: 1, fontSize: 17, minHeight: 88, maxHeight: 200, textAlignVertical: "top" },
});
