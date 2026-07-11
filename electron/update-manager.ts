import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  AcpBridgeEvent as AgentBridgeEvent,
  AcpSessionState as AgentRuntimeSnapshot,
} from "../contracts/acp.ts";
import type {
  InstallationMetadata,
  UpdateFailure,
  UpdateFailureCode,
  UpdateManifest,
  UpdateProgress,
  UpdateRunRecord,
  UpdateRunResult,
  UpdateState,
} from "../contracts/updates.ts";
import { parseUpdateManifest } from "./update-manifest.ts";
import {
  assertUpdateTransition,
  createIdleUpdateState,
  readUpdateState,
  writeUpdateStateAtomic,
} from "./update-state.ts";
import {
  readAndValidateInstallationAgainstActive,
  readInstallationMetadata,
  writeInstallationMetadata,
} from "./update-installation.ts";
import {
  assertCleanWorkspace,
  buildUpdaterPrompt,
  fetchUpstreamRef,
  getGitHead,
  getUpdatePrNumber,
} from "./update-git.ts";
import { validateCandidate } from "./update-validation.ts";
import {
  assertPostSwapInvariants,
  createCandidateFromActive,
  finalizePromotion,
  getActivePath,
  getCandidatePath,
  getInstallationMetadataPath,
  getPreviousPath,
  getUpdateStatePath,
  getUpdatesPath,
  normalizeActiveBeforeUpdate,
  prepareCandidateDependencies,
  promoteCandidate,
  recoverInterruptedPromotion,
  removeCandidate,
  rollbackPromotion,
} from "./workspace-manager.ts";
import {
  dirtyFilesFromStatus,
  formatDiagnosticsForLog,
  getCandidateWorkspaceDiagnostics,
} from "./update-candidate-diagnostics.ts";
import {
  appendUpdateRunTranscript,
  getRunTranscriptPath,
  serializeBridgeEvent,
} from "./update-run-transcript.ts";
import {
  appendUpdateRunLog,
  createRunId,
  getRunLogPath,
  readNewestUpdateRunRecord,
  readUpdateRunRecord,
  writeUpdateRunRecordAtomic,
} from "./update-run-record.ts";

const execFileAsync = promisify(execFile);
const CHECK_INTERVAL_MS = 5 * 60 * 60 * 1000;
type ManifestRefreshResult = { status: "available" | "none" | "error"; error?: string };
const RUNNING_PHASES: UpdateState["phase"][] = [
  "preparing",
  "fetching-upstream",
  "agent-running",
  "installing-dependencies",
  "validating",
  "ready-to-promote",
  "promoting",
  "awaiting-health-check",
  "rolling-back",
];

interface UpdateAgentBridge {
  activateUpdater(candidatePath: string): Promise<void>;
  sendUpdaterPrompt(prompt: string): Promise<string>;
  abortUpdater(): Promise<void>;
  disposeUpdater(): Promise<void>;
  getUpdaterState(): AgentRuntimeSnapshot;
  setUpdaterEventHandler?(handler: ((payload: AgentBridgeEvent) => void) | null): void;
  isEditorActive(): boolean;
  isEditorBusy(): boolean;
}

function manifestPath(): string {
  return join(getUpdatesPath(), "manifest.json");
}

function readManifestFile(): UpdateManifest | null {
  const path = manifestPath();
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as UpdateManifest;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeFailure(
  code: UpdateFailureCode,
  message: string,
  step: UpdateFailure["step"],
): UpdateFailure {
  return { code, message, step, at: new Date().toISOString() };
}

function throwUpdateFailure(failure: UpdateFailure): never {
  throw Object.assign(new Error(failure.message), { updateFailure: failure });
}

function failureFromError(error: unknown, phase: UpdateState["phase"]): UpdateFailure {
  const maybeFailure = (error as { updateFailure?: UpdateFailure } | null)?.updateFailure;
  if (maybeFailure) return maybeFailure;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Update cancelled")) {
    return makeFailure("AGENT_CANCELLED", message, "agent");
  }
  if (message.includes("Installation metadata is stale")) {
    return makeFailure("INSTALLATION_STALE", message, "preflight");
  }
  if (message.includes("Active workspace changed") || message.includes("uncommitted changes")) {
    return makeFailure("ACTIVE_DRIFT", message, "preflight");
  }
  if (phase === "agent-running") return makeFailure("AGENT_RUNTIME", message, "agent");
  if (phase === "promoting" || phase === "awaiting-health-check" || phase === "rolling-back") {
    return makeFailure("PROMOTION_HEALTH", message, "promotion");
  }
  return makeFailure("VALIDATION", message, phase === "validating" ? "validation" : "preflight");
}

export class UpdateManager {
  private readonly options: {
    manifestUrl: string | null;
    repositoryUrl: string | null;
    agent: UpdateAgentBridge;
    broadcastState: (state: UpdateState) => void;
    broadcastProgress: (progress: UpdateProgress) => void;
    broadcastUpdaterEvent: (payload: AgentBridgeEvent) => void;
    prepareForUpdate: () => Promise<void>;
    restartPromotedApp: () => Promise<void>;
  };
  private state: UpdateState;
  private running: Promise<UpdateRunResult> | null = null;
  private cancelled = false;
  private lastCheckAt = 0;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private healthResolve: ((healthy: boolean) => void) | null = null;
  private currentRun: UpdateRunRecord | null = null;
  private lastTranscriptMessageCount = 0;

  constructor(options: {
    manifestUrl: string | null;
    repositoryUrl: string | null;
    agent: UpdateAgentBridge;
    broadcastState: (state: UpdateState) => void;
    broadcastProgress: (progress: UpdateProgress) => void;
    broadcastUpdaterEvent: (payload: AgentBridgeEvent) => void;
    prepareForUpdate: () => Promise<void>;
    restartPromotedApp: () => Promise<void>;
  }) {
    this.options = options;
    try {
      this.state = readUpdateState(getUpdateStatePath());
    } catch (error) {
      const statePath = getUpdateStatePath();
      if (existsSync(statePath))
        renameSync(statePath, join(getUpdatesPath(), `state.corrupt-${Date.now()}.json`));
      this.state = createIdleUpdateState();
      this.state.error = `Recovered unreadable workspace update state: ${message(error)}`;
      writeUpdateStateAtomic(statePath, this.state);
    }
    this.options.agent.setUpdaterEventHandler?.((payload) => {
      this.handleUpdaterEvent(payload);
      this.options.broadcastUpdaterEvent(payload);
    });
  }

  getState(): UpdateState {
    return structuredClone(this.state);
  }

  getManifest(): UpdateManifest | null {
    return readManifestFile();
  }

  getInstallation(): InstallationMetadata {
    return readInstallationMetadata();
  }

  getRun(runId: string): UpdateRunRecord | null {
    return readUpdateRunRecord(runId);
  }

  getUpdaterSnapshot(): AgentRuntimeSnapshot {
    return this.options.agent.getUpdaterState();
  }

  private persist(patch: Partial<UpdateState>, phase?: UpdateState["phase"]): void {
    const nextPhase = phase ?? this.state.phase;
    assertUpdateTransition(this.state.phase, nextPhase);
    this.state = {
      ...this.state,
      ...patch,
      phase: nextPhase,
      updated_at: new Date().toISOString(),
    };
    writeUpdateStateAtomic(getUpdateStatePath(), this.state);
    this.options.broadcastState(this.getState());
  }

  private writeRun(record: UpdateRunRecord): void {
    this.currentRun = record;
    writeUpdateRunRecordAtomic(record.run_id, record);
  }

  private patchRun(patch: (record: UpdateRunRecord) => UpdateRunRecord): UpdateRunRecord | null {
    const existing =
      this.currentRun ?? (this.state.run_id ? readUpdateRunRecord(this.state.run_id) : null);
    if (!existing) return null;
    const next = patch(structuredClone(existing));
    this.writeRun(next);
    return next;
  }

  private log(line: string): void {
    const runId = this.currentRun?.run_id ?? this.state.run_id;
    if (runId) appendUpdateRunLog(runId, line);
  }

  private logLines(lines: string[]): void {
    for (const line of lines) this.log(line);
  }

  private transcriptRunId(): string | null {
    return this.currentRun?.run_id ?? this.state.run_id;
  }

  private logTranscript(entry: Parameters<typeof appendUpdateRunTranscript>[1]): void {
    const runId = this.transcriptRunId();
    if (!runId) return;
    appendUpdateRunTranscript(runId, entry);
  }

  private logBridgePayload(payload: AgentBridgeEvent): void {
    this.logTranscript({ kind: "bridge", payload: serializeBridgeEvent(payload) });
  }

  private async logCandidateDiagnostics(
    label: string,
    gitRef: string,
    filesChanges: string[],
  ): Promise<void> {
    const diagnostics = await getCandidateWorkspaceDiagnostics(
      getCandidatePath(),
      gitRef,
      filesChanges,
    );
    this.logLines(formatDiagnosticsForLog(label, diagnostics));
  }

  private logUpdaterSnapshot(label: string): void {
    const snapshot = this.options.agent.getUpdaterState();
    this.log(
      `agent_snapshot=${label} streaming=${snapshot.isStreaming} entries=${snapshot.entries.length} session=${snapshot.agentSessionId ?? "none"}`,
    );
    const lastAssistant = [...snapshot.entries]
      .reverse()
      .find((entry) => entry.type === "agent_text");
    if (lastAssistant?.text) {
      const preview = lastAssistant.text;
      this.log(
        `agent_snapshot=${label} last_assistant=${JSON.stringify(
          preview.length > 240 ? `${preview.slice(0, 240)}…` : preview,
        )}`,
      );
    }
  }

  private progress(phase: UpdateState["phase"], message: string, detail?: string): void {
    this.persist({}, phase);
    this.log(`phase=${phase}${detail ? ` detail=${JSON.stringify(detail)}` : ""}`);
    this.options.broadcastProgress({ phase, message, detail });
  }

  private handleUpdaterEvent(payload: AgentBridgeEvent): void {
    if (!this.currentRun) return;
    this.logBridgePayload(payload);
    if (payload.type === "session-state") {
      const messageCount = payload.state.entries.length;
      if (messageCount !== this.lastTranscriptMessageCount) {
        this.lastTranscriptMessageCount = messageCount;
        this.logTranscript({
          kind: "session_messages",
          label: `snapshot_${messageCount}`,
          messages: payload.state.entries,
        });
      }
      this.patchRun((record) => ({
        ...record,
        agent: {
          ...record.agent,
          session_id: payload.state.agentSessionId ?? record.agent.session_id,
          status: payload.state.isStreaming ? "streaming" : record.agent.status,
          message_count: messageCount,
        },
      }));
      return;
    }
    if (payload.type === "stop") {
      this.patchRun((record) => ({
        ...record,
        agent: {
          ...record.agent,
          status: "completed",
          last_event: "stop",
          ended_at: new Date().toISOString(),
        },
      }));
      return;
    }
    if (payload.type === "session-update") {
      // session-update is also mirrored into session-state by the connection manager
      this.log(`agent_event=session_update kind=${payload.update.sessionUpdate}`);
    }
  }

  async recover(): Promise<void> {
    rmSync(join(getUpdatesPath(), "context"), { recursive: true, force: true });
    const run =
      (this.state.run_id ? readUpdateRunRecord(this.state.run_id) : null) ??
      (RUNNING_PHASES.includes(this.state.phase) ? readNewestUpdateRunRecord() : null);
    if (run) this.currentRun = run;

    const directoryRecovery = recoverInterruptedPromotion();
    if (directoryRecovery !== "none") {
      if (directoryRecovery === "candidate-promoted") rollbackPromotion();
      this.failRecoveredRun(
        makeFailure(
          "PROMOTION_SWAP",
          `Recovered interrupted promotion: ${directoryRecovery}.`,
          "promotion",
        ),
      );
    } else if (run?.promotion.status === "health_ok") {
      this.progress("promoting", "Finalizing a health-confirmed update after restart");
      finalizePromotion();
      const candidateCommit = run.candidate_commit ?? run.promotion.candidate_commit;
      if (!candidateCommit) {
        this.failRecoveredRun(
          makeFailure(
            "PROMOTION_FINALIZE",
            "Recovered update is missing candidate commit.",
            "promotion",
          ),
        );
      } else {
        writeInstallationMetadata({
          installed_version: run.target_version,
          customized_head_commit: candidateCommit,
          last_healthy_at: new Date().toISOString(),
        });
        this.writeRun({
          ...run,
          promotion: {
            ...run.promotion,
            status: "finalized",
            finalized_at: new Date().toISOString(),
          },
          outcome: "completed",
          finished_at: new Date().toISOString(),
        });
        this.persist({ error: null, scheduled_for_quit: false }, "completed");
      }
    } else if (
      (this.state.phase === "promoting" || this.state.phase === "awaiting-health-check") &&
      existsSync(getPreviousPath())
    ) {
      this.progress("rolling-back", "Restoring the previous version after an interrupted launch");
      rollbackPromotion();
      this.failRecoveredRun(
        makeFailure(
          "PROMOTION_HEALTH",
          "The interrupted promoted version was rolled back before startup.",
          "promotion",
        ),
      );
    } else if (
      [
        "preparing",
        "fetching-upstream",
        "agent-running",
        "installing-dependencies",
        "validating",
      ].includes(this.state.phase)
    ) {
      removeCandidate();
      this.failRecoveredRun(
        makeFailure("VALIDATION", "Interrupted update preparation was cleaned up.", "preflight"),
      );
    } else if (this.state.phase === "rolling-back") {
      rollbackPromotion();
      this.failRecoveredRun(
        makeFailure("PROMOTION_HEALTH", "Interrupted rollback was completed.", "promotion"),
      );
    } else if (this.state.phase === "ready-to-promote") {
      this.failRecoveredRun(
        makeFailure(
          "PROMOTION_SWAP",
          "A validated candidate was left pending; inspect candidate before retrying.",
          "promotion",
        ),
      );
    } else if (this.state.phase === "completed") {
      rmSync(getPreviousPath(), { recursive: true, force: true });
    }
    await this.validateRecoveredInstallationMetadata();
    if (this.state.phase === "failed") this.options.broadcastState(this.getState());
  }

  private failRecoveredRun(failure: UpdateFailure): void {
    const run = this.currentRun;
    if (run) {
      appendUpdateRunLog(
        run.run_id,
        `failure code=${failure.code} message=${JSON.stringify(failure.message)}`,
      );
      this.writeRun({
        ...run,
        failure,
        outcome: "failed",
        finished_at: new Date().toISOString(),
        promotion:
          failure.step === "promotion"
            ? {
                ...run.promotion,
                status: run.promotion.status === "health_ok" ? "failed" : "rolled_back",
                error: failure.message,
                rollback_reason: failure.message,
              }
            : run.promotion,
      });
    }
    this.persist(
      {
        error: failure.message,
        scheduled_for_quit: false,
        run_id: run?.run_id ?? this.state.run_id,
      },
      "failed",
    );
  }

  private async validateRecoveredInstallationMetadata(): Promise<void> {
    if (!existsSync(getInstallationMetadataPath()) || !existsSync(getActivePath())) return;
    try {
      readAndValidateInstallationAgainstActive({ repair: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.persist({ error: message }, "failed");
    }
  }

  startPeriodicChecks(): void {
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => void this.check().catch(() => {}), CHECK_INTERVAL_MS);
  }

  stopPeriodicChecks(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
  }

  isCheckStale(): boolean {
    return Date.now() - this.lastCheckAt > CHECK_INTERVAL_MS;
  }

  private async refreshManifest(updateState: boolean): Promise<ManifestRefreshResult> {
    const installation = readInstallationMetadata();
    try {
      const response = await fetch(this.options.manifestUrl!, {
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (response.status === 204) {
        rmSync(manifestPath(), { force: true });
        if (updateState) this.persist({ scheduled_for_quit: false, error: null }, "idle");
        return { status: "none" };
      }
      if (!response.ok) throw new Error(`Manifest request failed (${response.status}).`);
      const manifest = parseUpdateManifest(
        await response.json(),
        installation.installed_version,
        this.options.repositoryUrl!,
      );
      mkdirSync(getUpdatesPath(), { recursive: true });
      writeFileSync(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`);
      if (updateState) {
        this.persist(
          {
            scheduled_for_quit: this.state.scheduled_for_quit,
            error: null,
          },
          this.state.scheduled_for_quit ? "scheduled" : "available",
        );
      }
      return { status: "available" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not newer")) {
        rmSync(manifestPath(), { force: true });
        if (updateState) this.persist({ scheduled_for_quit: false, error: null }, "idle");
        return { status: "none" };
      }
      console.warn("[UpdateManager] Update check failed:", message);
      return { status: "error", error: message };
    }
  }

  async check(): Promise<UpdateState> {
    this.lastCheckAt = Date.now();
    if (!this.options.manifestUrl || !this.options.repositoryUrl || this.running)
      return this.getState();
    await this.refreshManifest(this.state.phase !== "failed");
    return this.getState();
  }

  scheduleForQuit(): UpdateState {
    if (this.state.phase === "failed") {
      throw new Error("The previous workspace update failed and must be reviewed before retrying.");
    }
    if (!readManifestFile()) throw new Error("No update is available.");
    this.persist({ scheduled_for_quit: true }, "scheduled");
    return this.getState();
  }

  announceScheduledQuit(): UpdateState {
    if (!this.state.scheduled_for_quit || !readManifestFile()) return this.getState();
    this.options.broadcastProgress({
      phase: "scheduled",
      message: "Scheduled update will begin when Pipper quits.",
    });
    return this.getState();
  }

  dismiss(): UpdateState {
    if (this.state.phase === "failed") return this.getState();
    const manifest = readManifestFile();
    this.persist({ scheduled_for_quit: false, error: null }, manifest ? "available" : "idle");
    return this.getState();
  }

  async cancel(): Promise<UpdateRunResult> {
    if (this.state.phase === "failed" && !this.running) {
      return {
        success: false,
        error: "The previous workspace update failed and must be reviewed before retrying.",
      };
    }
    this.cancelled = true;
    await this.options.agent.abortUpdater();
    this.healthResolve?.(false);
    if (!this.running) {
      this.persist({ scheduled_for_quit: false }, readManifestFile() ? "available" : "idle");
    }
    return { success: false, cancelled: true };
  }

  startNow(): Promise<UpdateRunResult> {
    if (this.state.phase === "failed") {
      return Promise.resolve({
        success: false,
        error: "The previous workspace update failed and must be reviewed before retrying.",
      });
    }
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async retryFailedUpdate(): Promise<UpdateState> {
    if (this.state.phase !== "failed") return this.getState();
    let manifest = readManifestFile();
    if (!manifest) {
      if (!this.options.manifestUrl || !this.options.repositoryUrl) return this.getState();
      const result = await this.refreshManifest(false);
      if (result.status === "error") {
        this.options.broadcastState(this.getState());
        return this.getState();
      }
      manifest = readManifestFile();
    }
    if (!manifest) {
      this.persist({ error: null, run_id: null, scheduled_for_quit: false }, "idle");
      return this.getState();
    }
    this.persist({ error: null, scheduled_for_quit: false }, "available");
    return this.getState();
  }

  private ensureNotCancelled(): void {
    if (this.cancelled)
      throwUpdateFailure(makeFailure("AGENT_CANCELLED", "Update cancelled.", "agent"));
  }

  private async createRunRecord(manifest: UpdateManifest): Promise<UpdateRunRecord> {
    const runId = createRunId();
    const activeHead = await getGitHead(getActivePath());
    const prNumber = getUpdatePrNumber(manifest, this.options.repositoryUrl!);
    const record: UpdateRunRecord = {
      run_id: runId,
      started_at: new Date().toISOString(),
      installed_version_at_start: readInstallationMetadata().installed_version,
      target_version: manifest.version,
      pr_url: manifest.pr_url,
      pr_number: prNumber,
      git_ref: `refs/pipper-update/pr-${prNumber}`,
      files_changes: manifest.files_changes,
      active_head_at_start: activeHead,
      agent: { status: "pending", tool_count: 0 },
      promotion: { status: "pending" },
      log_path: getRunLogPath(runId),
      transcript_path: getRunTranscriptPath(runId),
    };
    this.writeRun(record);
    return record;
  }

  private async getCandidateDirtyFiles(): Promise<string[]> {
    const status = (await execFileAsync("git", ["status", "--short"], { cwd: getCandidatePath() }))
      .stdout;
    return dirtyFilesFromStatus(status);
  }

  private async run(): Promise<UpdateRunResult> {
    const manifest = readManifestFile();
    if (!manifest) {
      this.persist({ error: "No update is available.", scheduled_for_quit: false }, "failed");
      return { success: false, error: "No update is available." };
    }
    this.cancelled = false;
    const started = Date.now();
    const record = await this.createRunRecord(manifest);
    this.persist({ run_id: record.run_id, error: null }, "preparing");
    appendUpdateRunLog(record.run_id, "run=started");

    try {
      if (this.options.agent.isEditorActive() || this.options.agent.isEditorBusy()) {
        throwUpdateFailure(
          makeFailure(
            "ACTIVE_DRIFT",
            "Exit Edit Mode and accept or reject pending changes before updating.",
            "preflight",
          ),
        );
      }

      await this.options.prepareForUpdate();
      this.progress("preparing", "Preserving your current version");
      await normalizeActiveBeforeUpdate(getActivePath());
      const installation = readAndValidateInstallationAgainstActive({ repair: true });
      this.patchRun((run) => ({
        ...run,
        installed_version_at_start: installation.installed_version,
        active_head_at_start: readInstallationMetadata().customized_head_commit,
      }));
      const candidateSnapshot = await createCandidateFromActive();
      this.ensureNotCancelled();

      this.progress("fetching-upstream", "Downloading pinned upstream changes");
      const context = await fetchUpstreamRef(
        getCandidatePath(),
        manifest,
        this.options.repositoryUrl!,
      );
      this.ensureNotCancelled();

      this.progress("agent-running", "Adapting the update to your customizations");
      this.lastTranscriptMessageCount = 0;
      this.patchRun((run) => ({
        ...run,
        agent: { ...run.agent, status: "activating", activated_at: new Date().toISOString() },
      }));
      await this.options.agent.activateUpdater(getCandidatePath());
      const prompt = buildUpdaterPrompt(context);
      this.patchRun((run) => ({
        ...run,
        agent: { ...run.agent, status: "prompt_sent", prompt_sent_at: new Date().toISOString() },
      }));
      appendUpdateRunLog(record.run_id, "agent=prompt_sent");
      this.logTranscript({ kind: "prompt", text: prompt });
      await this.logCandidateDiagnostics("before_agent", context.git_ref, context.files_changes);
      this.logUpdaterSnapshot("before_agent");
      const summary = await this.options.agent.sendUpdaterPrompt(prompt);
      this.patchRun((run) => ({
        ...run,
        agent: {
          ...run.agent,
          status: "completed",
          ended_at: run.agent.ended_at ?? new Date().toISOString(),
          summary: run.agent.summary ?? summary,
        },
      }));
      this.ensureNotCancelled();

      this.logUpdaterSnapshot("after_agent");
      const finalSnapshot = this.options.agent.getUpdaterState();
      this.logTranscript({
        kind: "session_messages",
        label: "after_agent_final",
        messages: finalSnapshot.entries,
      });
      await this.logCandidateDiagnostics("after_agent", context.git_ref, context.files_changes);
      const dirtyFiles = await this.getCandidateDirtyFiles();
      const runAfterAgent = this.patchRun((run) => ({
        ...run,
        agent: { ...run.agent, candidate_dirty_files: dirtyFiles },
      }));
      this.log(
        `agent_result tool_count=${runAfterAgent?.agent.tool_count ?? 0} tools_used=${JSON.stringify(runAfterAgent?.agent.tools_used ?? [])} dirty_files=${JSON.stringify(dirtyFiles)}`,
      );
      if (dirtyFiles.length === 0) {
        const pendingUpstream = (
          await getCandidateWorkspaceDiagnostics(
            getCandidatePath(),
            context.git_ref,
            context.files_changes,
          )
        ).upstreamDiffs.filter((entry) => entry.hasDiff);
        if (pendingUpstream.length === 0) {
          this.log(
            "agent_result note=upstream_already_matches_candidate_head_no_working_tree_delta",
          );
        } else {
          this.log(
            `agent_result note=upstream_still_differs_files=${JSON.stringify(pendingUpstream.map((entry) => entry.file))}`,
          );
        }
        throwUpdateFailure(
          makeFailure("VALIDATION", "Update agent produced no candidate changes.", "agent"),
        );
      }

      const candidatePackagePath = join(getCandidatePath(), "package.json");
      const candidatePackage = JSON.parse(readFileSync(candidatePackagePath, "utf8"));
      let packageVersionChanged = false;
      if (candidatePackage.version !== manifest.version) {
        candidatePackage.version = manifest.version;
        writeFileSync(candidatePackagePath, `${JSON.stringify(candidatePackage, null, 2)}\n`);
        packageVersionChanged = true;
      }

      const packageChanged = packageVersionChanged || dirtyFiles.includes("package.json");
      this.progress("installing-dependencies", "Installing isolated candidate dependencies");
      await prepareCandidateDependencies(packageChanged);
      this.ensureNotCancelled();

      this.progress("validating", "Validating the updated application");
      const validationResults = await validateCandidate(getCandidatePath(), manifest);
      this.patchRun((run) => ({ ...run, validation_results: validationResults }));
      await assertCleanWorkspace(getActivePath());
      if ((await getGitHead(getActivePath())) !== candidateSnapshot.active_head) {
        throwUpdateFailure(
          makeFailure(
            "ACTIVE_DRIFT",
            "Active workspace changed while the update candidate was being prepared.",
            "preflight",
          ),
        );
      }
      await execFileAsync("git", ["add", "-A"], { cwd: getCandidatePath() });
      await execFileAsync(
        "git",
        ["commit", "-m", `Apply Pipper ${manifest.version} while preserving local customizations`],
        { cwd: getCandidatePath() },
      );
      const candidateCommit = await getGitHead(getCandidatePath());
      this.patchRun((run) => ({
        ...run,
        candidate_commit: candidateCommit,
        promotion: { ...run.promotion, candidate_commit: candidateCommit },
      }));

      this.progress("ready-to-promote", "Candidate passed validation");
      this.progress("promoting", "Promoting the validated update");
      const receipt = promoteCandidate();
      assertPostSwapInvariants(receipt, candidateCommit);
      this.patchRun((run) => ({
        ...run,
        promotion: {
          ...run.promotion,
          status: "swapped",
          candidate_commit: candidateCommit,
          active_head_before: receipt.active_head_before,
          active_head_after_swap: receipt.active_head_after,
          swapped_at: receipt.swapped_at,
        },
      }));
      appendUpdateRunLog(
        record.run_id,
        `promotion=swapped active_head_after=${receipt.active_head_after}`,
      );
      this.progress(
        "awaiting-health-check",
        "Waiting for the updated application to become healthy",
      );
      const healthSignal = new Promise<boolean>((resolve) => {
        this.healthResolve = resolve;
      });
      await this.options.restartPromotedApp();
      const healthy = await Promise.race([
        healthSignal,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 30_000)),
      ]);
      this.healthResolve = null;
      if (!healthy) {
        appendUpdateRunLog(record.run_id, "health=false reason=timeout_or_rejected");
        throwUpdateFailure(
          makeFailure(
            "PROMOTION_HEALTH",
            "The updated application did not report healthy within 30 seconds.",
            "promotion",
          ),
        );
      }
      this.patchRun((run) => ({
        ...run,
        promotion: { ...run.promotion, status: "health_ok", health_at: new Date().toISOString() },
      }));
      finalizePromotion();
      const nextInstallation: InstallationMetadata = {
        installed_version: manifest.version,
        customized_head_commit: candidateCommit,
        last_healthy_at: new Date().toISOString(),
      };
      writeInstallationMetadata(nextInstallation);
      this.patchRun((run) => ({
        ...run,
        promotion: {
          ...run.promotion,
          status: "finalized",
          finalized_at: new Date().toISOString(),
        },
        outcome: "completed",
        finished_at: new Date().toISOString(),
      }));
      appendUpdateRunLog(record.run_id, `run=completed duration_ms=${Date.now() - started}`);
      this.persist({ scheduled_for_quit: false, error: null }, "completed");
      return { success: true };
    } catch (error: any) {
      const failure = failureFromError(error, this.state.phase);
      const validationResults = Array.isArray(error?.results) ? error.results : undefined;
      if (validationResults) {
        this.patchRun((run) => ({ ...run, validation_results: validationResults }));
      }
      if (existsSync(getPreviousPath())) {
        try {
          this.progress("rolling-back", "Restoring the previous working version", failure.message);
          rollbackPromotion();
          this.patchRun((run) => ({
            ...run,
            promotion: {
              ...run.promotion,
              status: "rolled_back",
              error: failure.message,
              rollback_reason: failure.message,
            },
          }));
          await this.options.restartPromotedApp();
        } catch (rollbackError) {
          console.error("[UpdateManager] Rollback failed:", rollbackError);
        }
      } else {
        removeCandidate();
      }
      await this.options.agent.disposeUpdater().catch(() => {});
      this.patchRun((run) => ({
        ...run,
        failure,
        outcome: this.cancelled ? "cancelled" : "failed",
        finished_at: new Date().toISOString(),
        agent:
          failure.step === "agent"
            ? {
                ...run.agent,
                status: this.cancelled ? "cancelled" : "failed",
                error: failure.message,
                ended_at: run.agent.ended_at ?? new Date().toISOString(),
              }
            : run.agent,
        promotion:
          failure.step === "promotion" && run.promotion.status !== "rolled_back"
            ? { ...run.promotion, status: "failed", error: failure.message }
            : run.promotion,
      }));
      appendUpdateRunLog(
        record.run_id,
        `failure code=${failure.code} message=${JSON.stringify(failure.message)}`,
      );
      this.persist(
        { error: failure.message, scheduled_for_quit: false, run_id: record.run_id },
        "failed",
      );
      return { success: false, cancelled: this.cancelled, error: failure.message };
    } finally {
      await this.options.agent.disposeUpdater().catch(() => {});
    }
  }

  markActiveHealthy(version: string): boolean {
    const run =
      this.currentRun ?? (this.state.run_id ? readUpdateRunRecord(this.state.run_id) : null);
    if (this.state.phase !== "awaiting-health-check" || version !== run?.target_version) {
      if (run)
        appendUpdateRunLog(
          run.run_id,
          `health=false reason=version_or_phase_mismatch version=${version}`,
        );
      return false;
    }
    appendUpdateRunLog(run.run_id, "health=true");
    this.healthResolve?.(true);
    return true;
  }
}
