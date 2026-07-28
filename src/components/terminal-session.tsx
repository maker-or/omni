import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal, useTerminal, type WTerm } from "@wterm/react";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";
import { useTerminalStore } from "@/store/terminal-store";

interface TerminalSessionProps {
  sessionId: string;
  cwd?: string;
  isActive: boolean;
}

const RECOVERY_CHUNK_SIZE = 8_192;

async function loadGhosttyCore(): Promise<GhosttyCore> {
  try {
    const wasmPath = new URL("ghostty-vt.wasm", window.location.href).href;
    return await GhosttyCore.load({ wasmPath });
  } catch (primaryError) {
    // Package-relative loading is useful in preview/test packaging where the
    // public asset URL is not rooted beside the HTML entry point.
    try {
      return await GhosttyCore.load();
    } catch {
      throw primaryError;
    }
  }
}

export function TerminalSession({ sessionId, cwd, isActive }: TerminalSessionProps) {
  const [retryKey, setRetryKey] = useState(0);
  const [hasBeenActive, setHasBeenActive] = useState(isActive);

  useEffect(() => {
    if (isActive) setHasBeenActive(true);
  }, [isActive]);

  return (
    <div className="h-full w-full overflow-hidden">
      {hasBeenActive && (
        <TerminalInner
          key={retryKey}
          sessionId={sessionId}
          cwd={cwd}
          isActive={isActive}
          onRetry={() => setRetryKey((value) => value + 1)}
        />
      )}
    </div>
  );
}

interface TerminalInnerProps extends TerminalSessionProps {
  onRetry: () => void;
}

function TerminalInner({ sessionId, cwd, isActive, onRetry }: TerminalInnerProps) {
  const { ref, write } = useTerminal();
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readyTerminal, setReadyTerminal] = useState<WTerm | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isRecoveryComplete, setIsRecoveryComplete] = useState(false);
  const [initialSize, setInitialSize] = useState({ cols: 80, rows: 24 });
  const createdRef = useRef(false);
  const terminalMountStartedRef = useRef(false);
  const ptyReadyRef = useRef(false);
  const queuedInputRef = useRef("");
  const pendingSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const recoveryCompleteRef = useRef(false);
  const queuedLiveDataRef = useRef("");
  const exitDisplayedRef = useRef(false);
  const initialHistoryRef = useRef(
    useTerminalStore.getState().sessions.find((session) => session.id === sessionId)?.history ?? "",
  );
  const markRunning = useTerminalStore((state) => state.markRunning);
  const markError = useTerminalStore((state) => state.markError);

  useEffect(() => {
    let active = true;
    void loadGhosttyCore()
      .then((loadedCore) => {
        if (active) setCore(loadedCore);
      })
      .catch((err) => {
        console.error("Failed to load GhosttyCore:", err);
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, []);

  const handleReady = useCallback((terminal: WTerm) => {
    setReadyTerminal(terminal);
  }, []);

  const handleData = useCallback(
    (data: string) => {
      if (!ptyReadyRef.current) {
        queuedInputRef.current += data;
        return;
      }
      void window.omni.terminal.write(sessionId, data).catch((err) => {
        console.error(`[Terminal Session] Failed to write to PTY ${sessionId}:`, err);
      });
    },
    [sessionId],
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      pendingSizeRef.current = { cols, rows };
      if (!ptyReadyRef.current) return;
      void window.omni.terminal.resize(sessionId, cols, rows).catch((err) => {
        console.error(`[Terminal Session] Failed to resize PTY ${sessionId}:`, err);
      });
    },
    [sessionId],
  );

  // WTerm's ResizeObserver runs after its initial 80x24 setup. Give it two
  // frames to measure the visible container, then use that grid for PTY spawn.
  useEffect(() => {
    if (!readyTerminal) return;
    let secondFrameId = 0;
    const firstFrameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        const measured = pendingSizeRef.current ?? {
          cols: readyTerminal.cols,
          rows: readyTerminal.rows,
        };
        setInitialSize({
          cols: Math.max(1, measured.cols),
          rows: Math.max(1, measured.rows),
        });
        setIsReady(true);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrameId);
      window.cancelAnimationFrame(secondFrameId);
    };
  }, [readyTerminal]);

  // Store scrollback is deliberately plain recovery text. Replay it in small
  // animation-frame chunks once, then make live IPC the only rendering source.
  useEffect(() => {
    if (!isReady) return;
    const history = initialHistoryRef.current;
    let offset = 0;
    let frameId = 0;
    let active = true;

    const finish = () => {
      if (!active) return;
      if (queuedLiveDataRef.current) {
        write(queuedLiveDataRef.current);
        queuedLiveDataRef.current = "";
      }
      recoveryCompleteRef.current = true;
      setIsRecoveryComplete(true);
    };

    const writeNextChunk = () => {
      if (!active) return;
      const chunk = history.slice(offset, offset + RECOVERY_CHUNK_SIZE);
      if (!chunk) {
        finish();
        return;
      }
      write(chunk);
      offset += chunk.length;
      frameId = window.requestAnimationFrame(writeNextChunk);
    };

    if (history) frameId = window.requestAnimationFrame(writeNextChunk);
    else finish();

    return () => {
      active = false;
      window.cancelAnimationFrame(frameId);
    };
  }, [isReady, write]);

  // Keep this subscription for the lifetime of the emulator. App renders all
  // sessions continuously, including when an agent or another terminal is on
  // top, so VT state advances live without history replay.
  useEffect(() => {
    if (!isReady) return;
    return window.omni.terminal.onData((payload) => {
      if (payload.sessionId !== sessionId) return;
      if (recoveryCompleteRef.current) write(payload.data);
      else queuedLiveDataRef.current += payload.data;
    });
  }, [isReady, sessionId, write]);

  useEffect(() => {
    if (!isReady) return;
    return window.omni.terminal.onExit((payload) => {
      if (payload.sessionId !== sessionId || exitDisplayedRef.current) return;
      exitDisplayedRef.current = true;
      write(`\r\n[Process completed (exit ${payload.exitCode})]\r\n`);
    });
  }, [isReady, sessionId, write]);

  // Create only after recovery finishes, so fresh shell output cannot
  // interleave with recovered scrollback. The measured WTerm grid is sent as
  // part of creation, avoiding the old 80x24 spawn window.
  useEffect(() => {
    if (!core || !isReady || !isRecoveryComplete || createdRef.current) return;

    let active = true;
    createdRef.current = true;

    void window.omni.terminal
      .create(sessionId, cwd, initialSize.cols, initialSize.rows)
      .then(() => {
        if (!active) return;
        ptyReadyRef.current = true;
        markRunning(sessionId);
        const pendingSize = pendingSizeRef.current;
        if (
          pendingSize &&
          (pendingSize.cols !== initialSize.cols || pendingSize.rows !== initialSize.rows)
        ) {
          void window.omni.terminal
            .resize(sessionId, pendingSize.cols, pendingSize.rows)
            .catch((err) => {
              console.error(`[Terminal Session] Failed to apply PTY size ${sessionId}:`, err);
            });
        }
        if (queuedInputRef.current) {
          const input = queuedInputRef.current;
          queuedInputRef.current = "";
          void window.omni.terminal.write(sessionId, input).catch((err) => {
            console.error(`[Terminal Session] Failed to flush PTY input ${sessionId}:`, err);
          });
        }
      })
      .catch((err) => {
        if (!active) return;
        console.error("[Terminal Session] Failed to create backend PTY:", err);
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        markError(sessionId);
        write(`\r\nError: Failed to connect to shell backend. ${message}\r\n`);
      });

    return () => {
      active = false;
    };
  }, [
    core,
    cwd,
    initialSize.cols,
    initialSize.rows,
    isReady,
    isRecoveryComplete,
    markError,
    markRunning,
    sessionId,
    write,
  ]);

  useEffect(() => {
    if (!isReady || !isActive) return;
    const frameId = window.requestAnimationFrame(() => ref.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [isActive, isReady, ref]);

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 font-mono text-sm text-red-500">
        <span>Error loading terminal: {error}</span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-current px-3 py-1 text-xs hover:bg-red-500/10"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!core) {
    return <div className="h-full w-full bg-surface-1" aria-label="Initializing terminal" />;
  }

  if (!isActive && !terminalMountStartedRef.current) {
    return <div className="h-full w-full bg-surface-1" />;
  }
  terminalMountStartedRef.current = true;

  return (
    <Terminal
      ref={ref}
      core={core}
      autoResize
      onData={handleData}
      onResize={handleResize}
      onReady={handleReady}
      className="h-full w-full outline-none"
    />
  );
}
