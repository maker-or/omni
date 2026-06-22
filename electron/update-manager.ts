import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  InstallationMetadata,
  UpdateProgress,
  UpdateRunResult,
  UpdateState,
} from "../contracts/updates.ts";
import { parseUpdateManifest } from "./update-manifest.ts";
import { assertUpdateTransition, readUpdateState, writeUpdateStateAtomic } from "./update-state.ts";
import {
  acquireUpdateContext,
  assertCleanWorkspace,
  buildUpdaterPrompt,
  getGitHead,
} from "./update-git.ts";
import { validateCandidate } from "./update-validation.ts";
import {
  createCandidateFromActive,
  finalizePromotion,
  getActivePath,
  getCandidatePath,
  getInstallationMetadataPath,
  getPreviousPath,
  getUpdateStatePath,
  getUpdatesPath,
  prepareCandidateDependencies,
  promoteCandidate,
  recoverInterruptedPromotion,
  removeCandidate,
  rollbackPromotion,
} from "./workspace-manager.ts";

const execFileAsync = promisify(execFile);
const CHECK_INTERVAL_MS = 5 * 60 * 60 * 1000;

interface UpdateAgentBridge {
  activateUpdater(candidatePath: string): Promise<void>;
  sendUpdaterPrompt(prompt: string): Promise<string>;
  abortUpdater(): Promise<void>;
  disposeUpdater(): Promise<void>;
  isEditorActive(): boolean;
  isEditorBusy(): boolean;
}

export class UpdateManager {
  private readonly options: {
    manifestUrl: string | null;
    repositoryUrl: string | null;
    agent: UpdateAgentBridge;
    broadcastState: (state: UpdateState) => void;
    broadcastProgress: (progress: UpdateProgress) => void;
    prepareForUpdate: () => Promise<void>;
    restartPromotedApp: () => Promise<void>;
  };
  private state: UpdateState;
  private running: Promise<UpdateRunResult> | null = null;
  private cancelled = false;
  private lastCheckAt = 0;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private healthResolve: ((healthy: boolean) => void) | null = null;

  constructor(options: {
    manifestUrl: string | null;
    repositoryUrl: string | null;
    agent: UpdateAgentBridge;
    broadcastState: (state: UpdateState) => void;
    broadcastProgress: (progress: UpdateProgress) => void;
    prepareForUpdate: () => Promise<void>;
    restartPromotedApp: () => Promise<void>;
  }) {
    this.options = options;
    this.state = readUpdateState(getUpdateStatePath());
    this.state.dismissed_for_session = false;
  }

  getState(): UpdateState {
    return structuredClone(this.state);
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

  private progress(phase: UpdateState["phase"], message: string, detail?: string): void {
    this.persist({ progress_message: message }, phase);
    this.options.broadcastProgress({ phase, message, detail });
  }

  private readInstallation(): InstallationMetadata {
    return JSON.parse(readFileSync(getInstallationMetadataPath(), "utf8")) as InstallationMetadata;
  }

  async recover(): Promise<void> {
    const directoryRecovery = recoverInterruptedPromotion();
    if (directoryRecovery !== "none") {
      if (directoryRecovery === "candidate-promoted") rollbackPromotion();
      this.persist({ error: `Recovered interrupted promotion: ${directoryRecovery}.` }, "failed");
      return;
    }
    if (
      (this.state.phase === "promoting" || this.state.phase === "awaiting-health-check") &&
      existsSync(getPreviousPath())
    ) {
      this.progress("rolling-back", "Restoring the previous version after an interrupted launch");
      rollbackPromotion();
      this.persist(
        { error: "The interrupted promoted version was rolled back before startup." },
        "failed",
      );
      return;
    }
    if (
      [
        "preparing",
        "fetching-upstream",
        "agent-running",
        "installing-dependencies",
        "validating",
      ].includes(this.state.phase)
    ) {
      removeCandidate();
      this.persist({ error: "Interrupted update preparation was cleaned up." }, "failed");
    } else if (this.state.phase === "rolling-back") {
      rollbackPromotion();
      this.persist({ error: "Interrupted rollback was completed." }, "failed");
    } else if (this.state.phase === "ready-to-promote") {
      removeCandidate();
      this.persist(
        { error: "A validated candidate was left pending; the current version was kept." },
        "failed",
      );
    } else if (this.state.phase === "completed") {
      rmSync(getPreviousPath(), { recursive: true, force: true });
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

  async check(): Promise<UpdateState> {
    this.lastCheckAt = Date.now();
    if (!this.options.manifestUrl || !this.options.repositoryUrl || this.running)
      return this.getState();
    const installation = this.readInstallation();
    let response: Response;
    try {
      response = await fetch(this.options.manifestUrl, {
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Manifest request failed (${response.status}).`);
      const manifest = parseUpdateManifest(
        await response.json(),
        installation.installed_version,
        this.options.repositoryUrl,
      );
      mkdirSync(getUpdatesPath(), { recursive: true });
      writeFileSync(
        join(getUpdatesPath(), "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      this.persist(
        {
          from_version: installation.installed_version,
          to_version: manifest.version,
          manifest,
          scheduled_for_quit: this.state.scheduled_for_quit,
          dismissed_for_session: false,
          error: null,
        },
        this.state.scheduled_for_quit ? "scheduled" : "available",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not newer")) {
        this.persist(
          { manifest: null, to_version: null, scheduled_for_quit: false, error: null },
          "idle",
        );
        return this.getState();
      }
      console.warn("[UpdateManager] Update check failed:", message);
    }
    return this.getState();
  }

  scheduleForQuit(): UpdateState {
    if (!this.state.manifest) throw new Error("No update is available.");
    this.persist({ scheduled_for_quit: true, dismissed_for_session: false }, "scheduled");
    return this.getState();
  }

  announceScheduledQuit(): UpdateState {
    if (!this.state.scheduled_for_quit || !this.state.manifest) return this.getState();
    this.persist(
      { progress_message: "Scheduled update will begin when Pipper quits." },
      "scheduled",
    );
    return this.getState();
  }

  dismiss(): UpdateState {
    this.persist(
      { dismissed_for_session: true, scheduled_for_quit: false },
      this.state.manifest ? "available" : "idle",
    );
    return this.getState();
  }

  async cancel(): Promise<UpdateRunResult> {
    this.cancelled = true;
    await this.options.agent.abortUpdater();
    this.healthResolve?.(false);
    if (!this.running)
      this.persist(
        { scheduled_for_quit: false, progress_message: null },
        this.state.manifest ? "available" : "idle",
      );
    return { success: false, cancelled: true };
  }

  startNow(): Promise<UpdateRunResult> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private ensureNotCancelled(): void {
    if (this.cancelled) throw new Error("Update cancelled.");
  }

  private async run(): Promise<UpdateRunResult> {
    const manifest = this.state.manifest;
    if (!manifest) return { success: false, error: "No update is available." };
    if (this.options.agent.isEditorActive() || this.options.agent.isEditorBusy()) {
      this.persist({
        error: "Exit Edit Mode and accept or reject pending changes before updating.",
      });
      return {
        success: false,
        error: "Exit Edit Mode and accept or reject pending changes before updating.",
      };
    }
    this.cancelled = false;
    const installation = this.readInstallation();
    const started = Date.now();
    try {
      await assertCleanWorkspace(getActivePath());
      await this.options.prepareForUpdate();
      this.progress("preparing", "Preserving your current version");
      await createCandidateFromActive();
      this.ensureNotCancelled();

      this.progress("fetching-upstream", "Downloading pinned upstream changes");
      const context = await acquireUpdateContext(
        getCandidatePath(),
        manifest,
        this.options.repositoryUrl!,
      );
      this.ensureNotCancelled();

      this.progress("agent-running", "Adapting the update to your customizations");
      await this.options.agent.activateUpdater(getCandidatePath());
      const summary = await this.options.agent.sendUpdaterPrompt(buildUpdaterPrompt(context));
      this.persist({ agent_summary: summary });
      this.ensureNotCancelled();

      const candidatePackagePath = join(getCandidatePath(), "package.json");
      const candidatePackage = JSON.parse(readFileSync(candidatePackagePath, "utf8"));
      if (candidatePackage.version !== manifest.version) {
        candidatePackage.version = manifest.version;
        writeFileSync(candidatePackagePath, `${JSON.stringify(candidatePackage, null, 2)}\n`);
      }

      const packageChanged = (
        await execFileAsync("git", ["diff", "--name-only", "HEAD"], { cwd: getCandidatePath() })
      ).stdout
        .split("\n")
        .includes("package.json");
      this.progress("installing-dependencies", "Installing isolated candidate dependencies");
      await prepareCandidateDependencies(packageChanged);
      this.ensureNotCancelled();

      this.progress("validating", "Validating the updated application");
      const validationResults = await validateCandidate(getCandidatePath(), manifest);
      await assertCleanWorkspace(getActivePath());
      if ((await getGitHead(getActivePath())) !== installation.customized_head_commit) {
        throw new Error("Active workspace changed while the update candidate was being prepared.");
      }
      await execFileAsync("git", ["add", "-A"], { cwd: getCandidatePath() });
      await execFileAsync(
        "git",
        ["commit", "-m", `Apply Pipper ${manifest.version} while preserving local customizations`],
        { cwd: getCandidatePath() },
      );
      const candidateCommit = await getGitHead(getCandidatePath());
      this.persist({ validation_results: validationResults, candidate_commit: candidateCommit });

      this.progress("ready-to-promote", "Candidate passed validation");
      this.progress("promoting", "Promoting the validated update");
      promoteCandidate();
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
      if (!healthy)
        throw new Error("The updated application did not report healthy within 30 seconds.");
      finalizePromotion();
      const nextInstallation: InstallationMetadata = {
        installed_version: manifest.version,
        customized_head_commit: candidateCommit,
        last_healthy_at: new Date().toISOString(),
      };
      writeFileSync(
        getInstallationMetadataPath(),
        `${JSON.stringify(nextInstallation, null, 2)}\n`,
      );
      this.persist(
        {
          scheduled_for_quit: false,
          progress_message: `Updated in ${Date.now() - started}ms`,
          error: null,
        },
        "completed",
      );
      return { success: true };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      const validationResults = Array.isArray(error?.results)
        ? error.results
        : this.state.validation_results;
      if (existsSync(getPreviousPath())) {
        try {
          this.progress("rolling-back", "Restoring the previous working version", message);
          rollbackPromotion();
          await this.options.restartPromotedApp();
        } catch (rollbackError) {
          console.error("[UpdateManager] Rollback failed:", rollbackError);
        }
      } else {
        removeCandidate();
      }
      await this.options.agent.disposeUpdater().catch(() => {});
      this.persist(
        { error: message, validation_results: validationResults, scheduled_for_quit: false },
        "failed",
      );
      return { success: false, cancelled: this.cancelled, error: message };
    } finally {
      await this.options.agent.disposeUpdater().catch(() => {});
    }
  }

  markActiveHealthy(version: string): boolean {
    if (this.state.phase !== "awaiting-health-check" || version !== this.state.to_version)
      return false;
    this.healthResolve?.(true);
    return true;
  }
}
