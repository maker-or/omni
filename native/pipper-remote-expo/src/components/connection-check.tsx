import { router } from "expo-router";
import { useEffect, useState } from "react";

import { ButtonRow, Section, StatusRow } from "@/components/form";
import { Icon } from "@/components/icon";
import { useTheme } from "@/hooks/use-theme";
import { diagnosticsGuidance, diagnosticsReady } from "@/remote/catalog";
import { errorMessage, isHttpStatus } from "@/remote/client";
import { timeOfDay } from "@/remote/format";
import { remoteSession } from "@/remote/session";
import type { RemoteDiagnostics } from "@/remote/types";

interface ProbeResult {
  diagnostics: RemoteDiagnostics | null;
  macOutdated: boolean;
  error: string | null;
  checkedAt: number | null;
}

async function probe(): Promise<ProbeResult> {
  const result: ProbeResult = {
    diagnostics: null,
    macOutdated: false,
    error: null,
    checkedAt: null,
  };
  const client = remoteSession.client;
  if (!client) return result;
  try {
    result.diagnostics = await client.diagnostics();
    result.checkedAt = Date.now();
    await remoteSession.refreshCatalog();
  } catch (e) {
    if (!isHttpStatus(e, 404)) return { ...result, error: errorMessage(e) };
    // Older Macs lack diagnostics; confirm the pairing against an endpoint
    // every version serves.
    try {
      await client.listThreads();
      return { ...result, macOutdated: true, checkedAt: Date.now() };
    } catch (inner) {
      return { ...result, error: errorMessage(inner) };
    }
  }
  return result;
}

/**
 * Checks pairing, Pipper availability, installed agents, and projects.
 * Authenticated, unlike the public reachability endpoint.
 */
export function ConnectionCheck() {
  const theme = useTheme();
  const [diagnostics, setDiagnostics] = useState<RemoteDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Checks once on appear, so start in the checking state.
  const [checking, setChecking] = useState(true);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  /**
   * The Mac answered but predates /api/remote/diagnostics (404). The pairing
   * works; only the newer endpoints are missing.
   */
  const [macOutdated, setMacOutdated] = useState(false);

  const apply = (result: ProbeResult) => {
    setDiagnostics(result.diagnostics);
    setMacOutdated(result.macOutdated);
    setError(result.error);
    if (result.checkedAt) setCheckedAt(result.checkedAt);
    setChecking(false);
  };

  useEffect(() => {
    // Once on appear; later checks are explicit.
    void probe().then(apply);
  }, []);

  const check = () => {
    setChecking(true);
    void probe().then(apply);
  };

  const ok = <Icon ios="checkmark.circle" android="check_circle" color={theme.success} size={18} />;

  return (
    <Section
      header="Connection checks"
      footer={checkedAt ? `Last checked ${timeOfDay(checkedAt)}` : undefined}
    >
      <ButtonRow
        title={checking ? "Checking…" : "Test connection"}
        disabled={checking}
        onPress={check}
      />
      {macOutdated ? <StatusRow text="Mac reachable · pairing accepted" icon={ok} /> : null}
      {macOutdated ? (
        <StatusRow
          color="warning"
          text="Pipper on your Mac is older than this app, so connection checks and project names aren't available. Update Pipper on your Mac."
        />
      ) : null}
      {!macOutdated && error ? <StatusRow color="danger" text={error} /> : null}
      {!macOutdated && error ? (
        <StatusRow
          color="textSecondary"
          text="Keep Pipper open on your Mac. If you changed how it connects in Settings → Remote, pair this phone again."
        />
      ) : null}
      {diagnostics ? <StatusRow text="Mac reachable · pairing accepted" icon={ok} /> : null}
      {diagnostics ? (
        <StatusRow
          text={diagnostics.agentReady ? "Pipper is ready" : "Pipper is starting"}
          icon={
            diagnostics.agentReady ? (
              ok
            ) : (
              <Icon ios="clock" android="schedule" color={theme.warning} size={18} />
            )
          }
        />
      ) : null}
      {diagnostics ? (
        <StatusRow
          text={`${diagnostics.availableAgents} available agents · ${diagnostics.projects} projects`}
        />
      ) : null}
      {diagnostics ? (
        <StatusRow color="textSecondary" text={diagnosticsGuidance(diagnostics)} />
      ) : null}
      {diagnostics ? (
        <ButtonRow
          title="Run a sample task"
          disabled={!diagnosticsReady(diagnostics) || !!error || checking}
          onPress={() => router.push("/sample-task")}
        />
      ) : null}
    </Section>
  );
}
