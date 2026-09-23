import { Composio } from "@composio/core";
import { TypesafeProvider } from "@composio/typesafe";
import { BRIEF_SOURCES, type BriefSource } from "../../contracts/brief.ts";

/**
 * Thin, main-process-only gateway over Composio.
 *
 * One Composio client per (apiKey, typesafeKey) pair, configured with the
 * TypeSafe provider so the same client can (a) run read tools inside a
 * per-user session and (b) hand Jev typed tool sets for action routing.
 *
 * The session id is persisted by the caller (sessions don't expire server
 * side) so relaunches reuse it instead of minting a new one every time.
 */

export class BriefToolError extends Error {
  readonly tool: string;
  readonly notConnected: boolean;

  constructor(message: string, tool: string, notConnected: boolean) {
    super(message);
    this.name = "BriefToolError";
    this.tool = tool;
    this.notConnected = notConnected;
  }
}

export interface ComposioGatewayOptions {
  apiKey: string;
  typesafeApiKey: string | null;
  userId: string;
  sessionId: string | null;
  onSessionId: (sessionId: string) => void;
}

type ComposioSession = Awaited<ReturnType<Composio<TypesafeProvider>["create"]>>;

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isNotConnectedError(message: string): boolean {
  return /NoActiveConnection|No active connection|not connected|4302/i.test(message);
}

export class ComposioGateway {
  readonly provider: TypesafeProvider;
  readonly client: Composio<TypesafeProvider>;
  private sessionPromise: Promise<ComposioSession> | null = null;
  private readonly options: ComposioGatewayOptions;

  constructor(options: ComposioGatewayOptions) {
    this.options = options;
    this.provider = new TypesafeProvider(
      options.typesafeApiKey ? { apiKey: options.typesafeApiKey } : {},
    );
    this.client = new Composio({ apiKey: options.apiKey, provider: this.provider });
  }

  get userId(): string {
    return this.options.userId;
  }

  /** Lazily resolve the persisted session, creating one when missing/invalid. */
  session(): Promise<ComposioSession> {
    if (!this.sessionPromise) {
      this.sessionPromise = this.resolveSession().catch((error) => {
        this.sessionPromise = null;
        throw error;
      });
    }
    return this.sessionPromise;
  }

  private async resolveSession(): Promise<ComposioSession> {
    const existing = this.options.sessionId;
    if (existing) {
      try {
        return (await withTimeout(
          this.client.use(existing),
          15_000,
          "Composio session lookup",
        )) as ComposioSession;
      } catch (error) {
        console.warn("[Brief] Stored Composio session unusable, creating a new one:", error);
      }
    }
    const session = await withTimeout(
      this.client.create(this.options.userId, {
        toolkits: [...BRIEF_SOURCES],
        manageConnections: false,
        sandbox: { enable: false },
      }),
      20_000,
      "Composio session create",
    );
    this.options.onSessionId(session.sessionId);
    return session;
  }

  /** Which brief sources have an ACTIVE connected account for this user. */
  async connections(): Promise<Record<BriefSource, boolean>> {
    const session = await this.session();
    const result = await withTimeout(
      session.toolkits({ toolkits: [...BRIEF_SOURCES] }),
      15_000,
      "Composio toolkit status",
    );
    const connected = Object.fromEntries(BRIEF_SOURCES.map((s) => [s, false])) as Record<
      BriefSource,
      boolean
    >;
    for (const item of result.items) {
      const slug = item.slug.toLowerCase() as BriefSource;
      if (slug in connected) connected[slug] = item.connection?.isActive === true;
    }
    return connected;
  }

  /** Start an OAuth flow; returns the hosted Connect Link to open. */
  async authorize(source: BriefSource, callbackUrl?: string): Promise<string> {
    const session = await this.session();
    const request = await withTimeout(
      session.authorize(source, callbackUrl ? { callbackUrl } : undefined),
      20_000,
      "Composio authorize",
    );
    if (!request.redirectUrl) {
      throw new Error(`Composio did not return a connect link for ${source}.`);
    }
    return request.redirectUrl;
  }

  /** Run one tool as the connected user and return its `data` payload. */
  async execute(
    tool: string,
    args: Record<string, unknown>,
    timeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
  ): Promise<unknown> {
    const session = await this.session();
    let response: unknown;
    try {
      response = await withTimeout(session.execute(tool, args), timeoutMs, tool);
    } catch (error) {
      const message = errorMessage(error);
      throw new BriefToolError(message, tool, isNotConnectedError(message));
    }
    const record = (response ?? {}) as { data?: unknown; error?: unknown; successful?: boolean };
    if (record.error || record.successful === false) {
      const message = errorMessage(record.error ?? "Tool execution failed");
      throw new BriefToolError(message, tool, isNotConnectedError(message));
    }
    return record.data ?? response;
  }
}
