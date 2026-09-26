import { useEffect, useMemo, useState } from "react";
import { LogIn, Plus, Trash2, Users } from "lucide-react";
import { useAgentInstancesStore } from "@/store/agent-instances-store";
import type { AcpAgentInstance, AgentAccountSchema } from "../../contracts/acp.ts";

function envHint(instance: AcpAgentInstance, schema: AgentAccountSchema): string | null {
  const names = (instance.env ?? []).map((entry) => entry.name);
  if (names.length) return names.join(", ");
  if (instance.id === instance.driverId) return "Uses your existing CLI login";
  if (schema.authEnvVar) return schema.authEnvVar;
  return null;
}

function AccountRow({
  instance,
  schema,
  onRemove,
  onSignIn,
}: {
  instance: AcpAgentInstance;
  schema: AgentAccountSchema;
  onRemove: (id: string) => void;
  onSignIn: (id: string) => void;
}) {
  const isDefault = instance.id === instance.driverId;
  const hint = envHint(instance, schema);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">
          {instance.displayName}
          {isDefault ? (
            <span className="ml-2 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              DEFAULT
            </span>
          ) : null}
        </div>
        {hint ? (
          <div className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">{hint}</div>
        ) : null}
      </div>
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

/**
 * Settings section for managing provider accounts. Lets the user add a second
 * account for a driver (isolated via its credential-root env var) without
 * touching the default ambient login.
 */
export function AgentAccountsSettings() {
  const { instances, schemas, error, load, create, remove, launchLogin } = useAgentInstancesStore();
  const [addingDriverId, setAddingDriverId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const multiAccountSchemas = useMemo(
    () => schemas.filter((schema) => schema.supportsMultipleAccounts),
    [schemas],
  );

  const handleRemove = async (id: string) => {
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
        setNotice("A terminal opened — finish signing in there, then restart Pipper.");
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
      await create({
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
                  onRemove={handleRemove}
                  onSignIn={handleSignIn}
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
