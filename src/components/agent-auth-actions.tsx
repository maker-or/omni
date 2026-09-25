"use client";

import { useState } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { AuthMethod } from "../../contracts/acp.ts";

/**
 * Auth methods Pipper can complete through the ACP `authenticate` request.
 *
 * - `terminal` methods are run by the client as an interactive process; the
 *   spec forbids passing them to `authenticate`, so a button for one would
 *   always fail.
 * - `gemini-api-key` needs an API key that `authenticate` has no field for, so
 *   the agent reads it from the environment at spawn instead.
 */
export function signInMethods(methods: AuthMethod[] | null | undefined): AuthMethod[] {
  return (methods ?? []).filter(
    (method) => !("type" in method && method.type === "terminal") && method.id !== "gemini-api-key",
  );
}

/**
 * Sign-in buttons for the methods an agent actually advertises, shared by the
 * onboarding setup card and the workspace's persistent auth banner. The agent
 * runs the flow; Pipper never reads credential files.
 */
export function AgentAuthActions({
  agentId,
  methods,
  onAuthenticated,
}: {
  agentId: string;
  methods: AuthMethod[] | null | undefined;
  onAuthenticated?: () => void | Promise<void>;
}) {
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const supported = signInMethods(methods);
  if (supported.length === 0) return null;

  const authenticate = async (methodId: string) => {
    setAuthenticating(true);
    setAuthError(null);
    try {
      await window.omni.agent.authenticate(agentId, methodId);
      await onAuthenticated?.();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setAuthenticating(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {supported.map((method) => (
        <Button
          key={method.id}
          type="button"
          size="sm"
          variant="tertiary"
          disabled={authenticating}
          onClick={() => void authenticate(method.id)}
        >
          {authenticating ? "Signing in…" : method.name || method.id}
        </Button>
      ))}
      {authError && <p className="text-xs text-destructive">{authError}</p>}
    </div>
  );
}

/**
 * Persistent sign-in notice for the workspace. A failed session restore that
 * needs authentication keeps this visible (unlike a dismissible switch error),
 * with the agent's advertised sign-in methods inline.
 */
export function AgentAuthBanner({
  message,
  agentId,
  methods,
  onAuthenticated,
}: {
  message: string;
  agentId: string | null;
  methods: AuthMethod[] | null | undefined;
  onAuthenticated?: () => void | Promise<void>;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500">
      <WarningIcon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <span className="block">{message}</span>
        {agentId && (
          <AgentAuthActions agentId={agentId} methods={methods} onAuthenticated={onAuthenticated} />
        )}
      </div>
    </div>
  );
}
