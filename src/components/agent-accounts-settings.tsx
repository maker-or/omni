import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogIn, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { useAgentInstancesStore } from "@/store/agent-instances-store";
import type {
  AcpAgentInstance,
  AgentAccountSchema,
  AgentProbeResult,
} from "../../contracts/acp.ts";

function envHint(instance: AcpAgentInstance, schema: AgentAccountSchema): string | null {
  const names = (instance.env ?? []).map((entry) => entry.name);
  if (names.length) return names.join(", ");
  if (instance.id === instance.driverId) return "Uses your existing CLI login";
  if (schema.authEnvVar) return schema.authEnvVar;
  return null;
}

interface StatusView {
  label: string;
  textClass: string;
  dotClass: string;
}

function statusView(result: AgentProbeResult | undefined, probing: boolean): StatusView {
  if (probing) {
    return {
      label: "Checking…",
      textClass: "text-muted-foreground",
      dotClass: "bg-muted-foreground/60",
    };
  }
  if (!result) {
    return {
      label: "Not checked",
      textClass: "text-muted-foreground",
      dotClass: "bg-muted-foreground/40",
    };
  }
  switch (result.status) {
    case "ready":
      return { label: "Signed in", textClass: "text-emerald-600", dotClass: "bg-emerald-500" };
    case "needs-auth":
      return { label: "Sign-in required", textClass: "text-amber-600", dotClass: "bg-amber-500" };
    case "needs-install":
      return { label: "Not installed", textClass: "text-amber-600", dotClass: "bg-amber-500" };
    case "error":
      return { label: "Check failed", textClass: "text-destructive", dotClass: "bg-red-500" };
    default:
      return {
        label: "Unknown",
        textClass: "text-muted-foreground",
        dotClass: "bg-muted-foreground/60",
      };
  }
}

function StatusPill({ result, probing }: { result?: AgentProbeResult; probing: boolean }) {
  const view = statusView(result, probing);
  return (
    <span
      title={result?.message ?? undefined}
      className={`inline-flex items-center gap-1.5 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium ${view.textClass}`}
    >
      <span className={`size-1.5 rounded-full ${view.dotClass}`} />
      {view.label}
    </span>
  );
}

function AccountRow({
  instance,
  schema,
  result,
  probing,
  onRemove,
  onSignIn,
  onCheck,
}: {
  instance: AcpAgentInstance;
  schema: AgentAccountSchema;
  result?: AgentProbeResult;
  probing: boolean;
  onRemove: (id: string) => void;
  onSignIn: (id: string) => void;
  onCheck: (id: string) => void;
}) {
  const isDefault = instance.id === instance.driverId;
  const hint = envHint(instance, schema);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">
            {instance.displayName}
          </span>
          {isDefault ? (
            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              DEFAULT
            </span>
          ) : null}
          <StatusPill result={result} probing={probing} />
        </div>
        {hint ? (
          <div className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">{hint}</div>
        ) : null}
        {result && result.status !== "ready" && result.message ? (
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground/80">
            {result.message}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={`Check ${instance.displayName} sign-in status`}
        onClick={() => onCheck(instance.id)}
        disabled={probing}
        className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-3 hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className={`size-4 ${probing ? "animate-spin" : ""}`} strokeWidth={1.8} />
      </button>
      {schema.supportsLogin ? (
        <button
          type="button"
          onClick={() => onSignIn(instance.id)}
          className="flex items-center gap-1.5 rounded-lg bg-surface-3 px-2 py-1.5 text-[11px] font-medium text-foreground shadow-surface-1 hover:bg-surface-4"
        >
          <LogIn className="size-3.5" strokeWidth={1.9} />
          Sign in
        </button>
      ) : null}
      {isDefault ? null : (
        <button
          type="button"
          aria-label={`Remove ${instance.displayName}`}
          onClick={() => onRemove(instance.id)}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-3 hover:text-foreground"
        >
          <Trash2 className="size-4" strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

function AddAccountForm({
  schema,
  onSubmit,
  onCancel,
}: {
  schema: AgentAccountSchema;
  onSubmit: (input: { displayName: string; secret?: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const canSubmit = name.trim().length > 0 && (!schema.authEnvVar || secret.trim().length > 0);

  return (
    <div className="flex flex-col gap-2 border-t border-border/70 bg-surface-2/60 px-4 py-3">
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Account name (e.g. Work)"
        className="h-8 rounded-lg border border-border/70 bg-surface-1 px-2.5 text-[12px] text-foreground outline-none focus:border-border"
      />
      {schema.authEnvVar ? (
        <input
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder={schema.authEnvVar}
          type="password"
          className="h-8 rounded-lg border border-border/70 bg-surface-1 px-2.5 text-[12px] text-foreground outline-none focus:border-border"
        />
      ) : null}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit({ displayName: name.trim(), secret: secret.trim() || undefined })}
          className="rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-medium text-foreground shadow-surface-1 disabled:opacity-50"
        >
          Add account
        </button>
      </div>
    </div>
  );
}

/** How long to keep polling for sign-in completion after launching a login. */
const SIGNIN_POLL_INTERVAL_MS = 3_000;
const SIGNIN_POLL_MAX_ATTEMPTS = 40;

/**
 * Settings section for managing provider accounts. Lets the user add a second
 * account for a driver (isolated via its credential-root env var) without
 * touching the default ambient login. Each account shows a live sign-in status
 * (probed via a throwaway ACP session), and is polled after launching login so
 * completion is visible in the app rather than only in the terminal.
 */
export function AgentAccountsSettings() {
  const { instances, schemas, error, load, create, remove, launchLogin } = useAgentInstancesStore();
  const [addingDriverId, setAddingDriverId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<Record<string, AgentProbeResult>>({});
  const [probingIds, setProbingIds] = useState<Set<string>>(() => new Set());
  const probedRef = useRef<Set<string>>(new Set());
  const pollTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const inFlight = useRef<Map<string, Promise<AgentProbeResult | null>>>(new Map());
  /** Serializes probes so only one provider CLI is spawned at a time. */
  const probeQueue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    void load();
  }, [load]);

  const check = useCallback((id: string): Promise<AgentProbeResult | null> => {
    const existing = inFlight.current.get(id);
    if (existing) return existing;
    const run = async (): Promise<AgentProbeResult | null> => {
      if (!window.omni?.agent?.probeAgent) return null;
      const probeOnce = async (): Promise<AgentProbeResult> => {
        try {
          return await window.omni.agent.probeAgent(id);
        } catch (err) {
          return {
            agentId: id,
            status: "error",
            message: err instanceof Error ? err.message : "Check failed",
          };
        }
      };
      setProbingIds((prev) => new Set(prev).add(id));
      try {
        let result = await probeOnce();
        // A CLI that was mid-restart (or briefly contended) can close the ACP
        // connection; retry once before reporting a failure.
        if (result.status === "error") {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          result = await probeOnce();
        }
        setProbeResults((prev) => ({ ...prev, [id]: result }));
        return result;
      } finally {
        setProbingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    };
    // Queue behind any in-flight probe: concurrent agent spawns race on shared
    // resources (auth files, login ports) and produce spurious failures.
    const promise = probeQueue.current.then(run, run);
    probeQueue.current = promise.then(
      () => undefined,
      () => undefined,
    );
    inFlight.current.set(id, promise);
    void promise.finally(() => {
      if (inFlight.current.get(id) === promise) inFlight.current.delete(id);
    });
    return promise;
  }, []);

  const stopPolling = useCallback((id: string) => {
    const timer = pollTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      pollTimers.current.delete(id);
    }
  }, []);

  const startPolling = useCallback(
    (id: string) => {
      stopPolling(id);
      let attempts = 0;
      // Self-scheduling: wait for each probe to finish before the next, so a
      // slow agent can't stack up overlapping processes.
      const tick = async () => {
        attempts += 1;
        const result = await check(id);
        if (result?.status === "ready" || attempts >= SIGNIN_POLL_MAX_ATTEMPTS) {
          stopPolling(id);
          return;
        }
        const timer = setTimeout(() => void tick(), SIGNIN_POLL_INTERVAL_MS);
        pollTimers.current.set(id, timer);
      };
      const timer = setTimeout(() => void tick(), 1_500);
      pollTimers.current.set(id, timer);
    },
    [check, stopPolling],
  );

  // Stop any in-flight polling when the component unmounts.
  useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // Probe each account once so its status is visible without manual action.
  useEffect(() => {
    void (async () => {
      for (const instance of instances) {
        if (probedRef.current.has(instance.id)) continue;
        probedRef.current.add(instance.id);
        await check(instance.id);
      }
    })();
  }, [instances, check]);

  // Re-check when the user comes back to the app — e.g. after finishing a
  // sign-in that was started outside Pipper's own "Sign in" button.
  useEffect(() => {
    const onFocus = () => {
      for (const instance of instances) {
        if (probeResults[instance.id]?.status === "ready") continue;
        void check(instance.id);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [instances, probeResults, check]);

  const multiAccountSchemas = useMemo(
    () => schemas.filter((schema) => schema.supportsMultipleAccounts),
    [schemas],
  );

  const handleRemove = async (id: string) => {
    stopPolling(id);
    try {
      await remove(id);
    } catch {
      // Store surfaces the error.
    }
  };

  const handleSignIn = async (id: string) => {
    try {
      const result = await launchLogin(id);
      if (result.opened) {
        setNotice("Finish signing in the terminal window — status updates here automatically.");
        startPolling(id);
      } else {
        try {
          await navigator.clipboard?.writeText(result.command);
          setNotice(`Sign-in command copied to clipboard: ${result.command}`);
        } catch {
          setNotice(`Run this in your terminal: ${result.command}`);
        }
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not start sign-in");
    }
  };

  const handleAdd = async (
    schema: AgentAccountSchema,
    input: { displayName: string; secret?: string },
  ) => {
    try {
      const created = await create({
        driverId: schema.driverId,
        displayName: input.displayName,
        env:
          schema.authEnvVar && input.secret
            ? [{ name: schema.authEnvVar, value: input.secret, sensitive: true }]
            : undefined,
      });
      setAddingDriverId(null);
      setNotice(
        schema.supportsLogin
          ? "Account added. Click Sign in to authenticate it."
          : "Account added.",
      );
      // A newly created account has no probe result yet.
      void check(created.id);
      probedRef.current.add(created.id);
    } catch {
      // Store surfaces the error.
    }
  };

  return (
    <div>
      {error ? <div className="px-4 py-3 text-[11px] text-destructive">{error}</div> : null}
      {notice ? (
        <div className="px-4 py-3 text-[11px] leading-4 text-muted-foreground">{notice}</div>
      ) : null}
      {multiAccountSchemas.map((schema, index) => {
        const accounts = instances.filter((instance) => instance.driverId === schema.driverId);
        return (
          <div key={schema.driverId}>
            {index > 0 ? <div className="h-px bg-border/70" /> : null}
            <div className="flex items-center gap-4 px-4 pt-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-muted-foreground shadow-surface-1">
                <Users className="size-[18px]" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-foreground">{schema.displayName}</div>
                <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {accounts.length > 1
                    ? `${accounts.length} accounts connected`
                    : "Add a second account for this provider"}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setAddingDriverId(addingDriverId === schema.driverId ? null : schema.driverId)
                }
                className="flex items-center gap-1 rounded-lg bg-surface-3 px-2 py-1.5 text-[11px] font-medium text-foreground shadow-surface-1 hover:bg-surface-4"
              >
                <Plus className="size-3.5" strokeWidth={2} />
                Add
              </button>
            </div>
            <div className="mt-1 pb-2">
              {accounts.map((instance) => (
                <AccountRow
                  key={instance.id}
                  instance={instance}
                  schema={schema}
                  result={probeResults[instance.id]}
                  probing={probingIds.has(instance.id)}
                  onRemove={handleRemove}
                  onSignIn={handleSignIn}
                  onCheck={(id) => void check(id)}
                />
              ))}
              {addingDriverId === schema.driverId ? (
                <AddAccountForm
                  schema={schema}
                  onSubmit={(input) => void handleAdd(schema, input)}
                  onCancel={() => setAddingDriverId(null)}
                />
              ) : null}
            </div>
          </div>
        );
      })}
      {multiAccountSchemas.length === 0 ? (
        <div className="px-4 py-3 text-[11px] text-muted-foreground">
          No providers with multi-account support are available.
        </div>
      ) : null}
    </div>
  );
}
