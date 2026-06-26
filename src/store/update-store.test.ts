import { afterEach, describe, expect, mock, test } from "bun:test";
import type { InstallationMetadata, UpdateManifest, UpdateState } from "../../contracts/updates.ts";

const installation: InstallationMetadata = {
  installed_version: "0.1.0",
  customized_head_commit: "head",
  last_healthy_at: "2026-06-23T00:00:00.000Z",
};

function state(phase: UpdateState["phase"], patch: Partial<UpdateState> = {}): UpdateState {
  return {
    phase,
    updated_at: "2026-06-25T00:00:00.000Z",
    scheduled_for_quit: false,
    error: null,
    run_id: null,
    ...patch,
  };
}

function manifest(version: string): UpdateManifest {
  return {
    schema_version: 1,
    version,
    description: `Update ${version}`,
    pr_url: "https://github.com/company/pipper/pull/1",
    files_changes: ["src/App.tsx"],
  };
}

async function loadStore() {
  const mod = await import("./update-store.ts");
  mod.__resetUpdateStoreForTests();
  return mod.useUpdateStore;
}

function installUpdateApi({
  currentState,
  currentManifest,
  checkState = currentState,
  retryState = currentState,
}: {
  currentState: UpdateState;
  currentManifest: UpdateManifest | null;
  checkState?: UpdateState;
  retryState?: UpdateState;
}) {
  const api = {
    check: mock(async () => checkState),
    getState: mock(async () => currentState),
    getManifest: mock(async () => currentManifest),
    getInstallation: mock(async () => installation),
    getRun: mock(async () => null),
    getUpdaterSnapshot: mock(async () => null),
    scheduleForQuit: mock(async () => currentState),
    startNow: mock(async () => ({ success: true })),
    retryFailedUpdate: mock(async () => retryState),
    dismiss: mock(async () => currentState),
    cancel: mock(async () => ({ success: false, cancelled: true })),
    quitWithoutUpdating: mock(async () => {}),
    markActiveHealthy: mock(async () => true),
    onStateChanged: mock(() => () => {}),
    onProgress: mock(() => () => {}),
    onUpdaterEvent: mock(() => () => {}),
  };
  (globalThis as any).window = { omni: { update: api } };
  return api;
}

afterEach(() => {
  delete (globalThis as any).window;
});

describe("update store", () => {
  test("dismisses only the current manifest version for the session", async () => {
    const available = state("available");
    const updateApi = installUpdateApi({
      currentState: available,
      currentManifest: manifest("0.2.0"),
      checkState: available,
    });
    const store = await loadStore();
    await store.getState().initialize();

    await store.getState().dismiss();
    expect(store.getState().dismissedForSession).toBeTrue();

    updateApi.getManifest.mockImplementation(async () => manifest("0.3.0"));
    await store.getState().check();
    expect(store.getState().dismissedForSession).toBeFalse();
  });

  test("retrying failed update recovers state and starts the update", async () => {
    const failed = state("failed", { error: "previous failure", run_id: "run-1" });
    const available = state("available", { run_id: "run-1" });
    const updateApi = installUpdateApi({
      currentState: failed,
      currentManifest: manifest("0.2.0"),
      retryState: available,
    });
    updateApi.getState.mockImplementation(async () => available);
    const store = await loadStore();
    await store.getState().initialize();

    await store.getState().retryFailedUpdate();
    expect(updateApi.retryFailedUpdate).toHaveBeenCalled();
    expect(updateApi.startNow).toHaveBeenCalled();
    expect(store.getState().state?.phase).toBe("available");
    expect(store.getState().detailsOpen).toBeTrue();
  });
});
