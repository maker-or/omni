import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

import { EMPTY_CATALOG } from "./catalog";
import { isHttpStatus, errorMessage, RemoteClient, RemoteClientError } from "./client";
import type { PairingLink } from "./pairing-link";
import { SubmissionStore } from "./submissions";
import type {
  LaptopOwner,
  RemoteAgentModel,
  RemoteCatalog,
  RemoteConfig,
  RemoteThreadSummary,
} from "./types";

const Keys = {
  /** The paired laptop (address, name, owner) without its token. */
  laptop: "remote.laptop",
  /** This phone's device token for that laptop (Keychain / Keystore). */
  deviceToken: "remote.deviceToken",
  catalog: "remote.catalog",
  catalogRefreshedAt: "remote.catalogRefreshedAt",
  /** Project shown on Home; preselected for new threads. */
  homeProjectId: "home.projectId",
} as const;

// Readable after first unlock, like the iOS app, so background work and
// lock-screen shortcuts can reach the Mac.
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

const CATALOG_MAX_AGE_MS = 10 * 60 * 1000;

export interface SessionState {
  /** False until stored pairing and catalog are loaded at launch. */
  hydrated: boolean;
  config: RemoteConfig | null;
  /** Why the phone is back on the pairing screen (revoked). */
  pairNotice: string | null;
  catalog: RemoteCatalog;
  catalogError: string | null;
  lastCatalogRefresh: number | null;
  /** Models inside each agent, keyed by agent id. Empty until fetched. */
  agentModels: Record<string, RemoteAgentModel[]>;
  loadingAgentModels: boolean;
  /** False once the Mac answered 404: its Pipper predates model choice. */
  agentModelsSupported: boolean;
  agentModelsError: string | null;
  homeProjectId: string;
}

const initialState: SessionState = {
  hydrated: false,
  config: null,
  pairNotice: null,
  catalog: EMPTY_CATALOG,
  catalogError: null,
  lastCatalogRefresh: null,
  agentModels: {},
  loadingAgentModels: false,
  agentModelsSupported: true,
  agentModelsError: null,
  homeProjectId: "",
};

/**
 * Process-wide remote state: pairing config, the cached catalog, and a
 * client built from them. Port of `RemoteSession` in the iOS app.
 */
class RemoteSessionStore {
  private state = initialState;
  private listeners = new Set<() => void>();
  private submissions = new SubmissionStore(
    AsyncStorage,
    (text) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
    () => Crypto.randomUUID(),
  );
  private hydration: Promise<void> | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): SessionState => this.state;

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  get isPaired(): boolean {
    return !!this.state.config?.token;
  }

  get client(): RemoteClient | null {
    const config = this.state.config;
    if (!config?.token) return null;
    const token = config.token;
    return new RemoteClient(config, () => {
      // Only drop the pairing that was refused, not one made since the
      // request started.
      if (this.state.config?.token !== token) return;
      void this.forget("Your Mac removed this phone, or its access expired. Pair again to use it.");
    });
  }

  hydrate(): Promise<void> {
    this.hydration ??= this.load();
    return this.hydration;
  }

  private async load(): Promise<void> {
    let config: RemoteConfig | null = null;
    let catalog = EMPTY_CATALOG;
    let lastCatalogRefresh: number | null = null;
    let homeProjectId = "";
    try {
      const [laptop, cached, refreshedAt, home] = await Promise.all([
        AsyncStorage.getItem(Keys.laptop),
        AsyncStorage.getItem(Keys.catalog),
        AsyncStorage.getItem(Keys.catalogRefreshedAt),
        AsyncStorage.getItem(Keys.homeProjectId),
      ]);
      const token = await SecureStore.getItemAsync(Keys.deviceToken, SECURE_OPTIONS);
      if (laptop && token) config = { ...(JSON.parse(laptop) as RemoteConfig), token };
      if (cached) catalog = JSON.parse(cached) as RemoteCatalog;
      lastCatalogRefresh = refreshedAt ? Number(refreshedAt) : null;
      homeProjectId = home ?? "";
    } catch (error) {
      console.warn("[remote] could not restore pairing", error);
    }
    this.set({ hydrated: true, config, catalog, lastCatalogRefresh, homeProjectId });
  }

  /** Name this phone gets in the laptop's device list. */
  static get deviceName(): string {
    return `${Device.modelName ?? "Phone"} · Pipper app`;
  }

  /**
   * Redeem a confirmed pairing link and keep this phone's device token. The
   * token goes to secure storage; the laptop's address and owner to storage.
   */
  async pair(link: PairingLink, owner: LaptopOwner | null): Promise<void> {
    const paired = await RemoteClient.redeemPairing(link, RemoteSessionStore.deviceName);
    const next: RemoteConfig = {
      baseURL: link.baseURL,
      token: paired.token.trim(),
      laptopName: paired.laptop?.name ?? null,
      owner,
      deviceName: paired.device.name,
    };
    await SecureStore.setItemAsync(Keys.deviceToken, next.token, SECURE_OPTIONS);
    await AsyncStorage.setItem(Keys.laptop, JSON.stringify({ ...next, token: "" }));
    if (this.state.config?.baseURL !== next.baseURL) await this.clearCatalog();
    this.set({ config: next, pairNotice: null });
    await this.refreshCatalog();
  }

  /**
   * Unpair from Settings: revoke on the laptop first (best effort), so the
   * token is dead even if it leaked, then forget it here.
   */
  async unpair(): Promise<void> {
    await this.client?.revokeThisDevice().catch(() => undefined);
    await this.forget(null);
  }

  private async forget(notice: string | null): Promise<void> {
    await Promise.all([
      AsyncStorage.removeItem(Keys.laptop),
      SecureStore.deleteItemAsync(Keys.deviceToken, SECURE_OPTIONS),
    ]).catch(() => undefined);
    await this.clearCatalog();
    this.set({ config: null, pairNotice: notice });
  }

  private async clearCatalog(): Promise<void> {
    await AsyncStorage.multiRemove([Keys.catalog, Keys.catalogRefreshedAt]).catch(() => undefined);
    this.set({
      catalog: EMPTY_CATALOG,
      catalogError: null,
      lastCatalogRefresh: null,
      agentModels: {},
      agentModelsError: null,
    });
  }

  /** Pull the laptop catalog and cache it for offline display. */
  async refreshCatalog(): Promise<RemoteCatalog | null> {
    const client = this.client;
    if (!client) return null;
    try {
      const fresh = await client.fetchCatalog();
      // A pairing change while the request was out makes this stale.
      if (this.state.config?.token !== client.config.token) return null;
      const now = Date.now();
      await AsyncStorage.multiSet([
        [Keys.catalog, JSON.stringify(fresh)],
        [Keys.catalogRefreshedAt, String(now)],
      ]).catch(() => undefined);
      this.set({ catalog: fresh, catalogError: null, lastCatalogRefresh: now });
      return fresh;
    } catch (error) {
      this.set({ catalogError: errorMessage(error) });
      return null;
    }
  }

  /** Refresh only when the cache is missing or older than ten minutes. */
  async refreshCatalogIfStale(): Promise<void> {
    const { lastCatalogRefresh, catalog } = this.state;
    if (
      lastCatalogRefresh !== null &&
      Date.now() - lastCatalogRefresh < CATALOG_MAX_AGE_MS &&
      catalog.projects.length > 0
    ) {
      return;
    }
    await this.refreshCatalog();
  }

  /**
   * Best effort: an older Mac (404) or a slow agent probe leaves the last
   * list in place, and the picker falls back to the agent's default.
   */
  async refreshAgentModels(): Promise<void> {
    const client = this.client;
    if (!client || this.state.loadingAgentModels) return;
    this.set({ loadingAgentModels: true });
    try {
      const agentModels = await client.agentModels();
      this.set({ agentModels, agentModelsSupported: true, agentModelsError: null });
    } catch (error) {
      if (isHttpStatus(error, 404)) {
        this.set({ agentModelsSupported: false, agentModelsError: null });
      } else {
        this.set({ agentModelsError: errorMessage(error) });
      }
    } finally {
      this.set({ loadingAgentModels: false });
    }
  }

  setHomeProjectId(id: string): void {
    this.set({ homeProjectId: id });
    void AsyncStorage.setItem(Keys.homeProjectId, id).catch(() => undefined);
  }

  async createThread(input: {
    projectId: string;
    agentId: string | null;
    model: string | null;
    prompt: string;
  }): Promise<RemoteThreadSummary> {
    const client = this.client;
    if (!client) throw new RemoteClientError("notPaired");
    // Same scope shape as the iOS app; `model` joins only when set.
    const scope = [
      client.config.baseURL,
      "create",
      input.projectId,
      input.agentId ?? "",
      ...(input.model ? [`model:${input.model}`] : []),
      input.prompt,
    ];
    return this.submit(scope, (requestId) => client.createThread({ ...input, requestId }));
  }

  async sendPrompt(threadId: string, prompt: string): Promise<void> {
    const client = this.client;
    if (!client) throw new RemoteClientError("notPaired");
    const scope = [client.config.baseURL, "prompt", threadId, prompt];
    await this.submit(scope, (requestId) => client.sendPrompt(threadId, prompt, requestId));
  }

  /**
   * Retains the request ID until the Mac acknowledges it. A confirmed
   * rejection means nothing was dispatched, so a deliberate retry may use a
   * new ID; timeouts keep the old one so the Mac can de-duplicate.
   */
  private async submit<T>(scope: string[], run: (requestId: string) => Promise<T>): Promise<T> {
    const requestId = await this.submissions.requestId(scope);
    try {
      const result = await run(requestId);
      await this.submissions.acknowledge(scope, requestId);
      return result;
    } catch (error) {
      if (error instanceof RemoteClientError && error.kind === "rejected") {
        await this.submissions.acknowledge(scope, requestId);
      }
      throw error;
    }
  }
}

export const remoteSession = new RemoteSessionStore();

export function useRemoteSession(): SessionState {
  return useSyncExternalStore(remoteSession.subscribe, remoteSession.getState);
}
