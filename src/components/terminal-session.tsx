import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import type { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";
import { useTerminalStore } from "@/store/terminal-store";
import { loadGhosttyCore } from "@/lib/ghostty-core";
import { subscribeToTerminalEvents } from "@/lib/terminal-event-router";

export interface TerminalSessionProps {
  sessionId: string;
  cwd?: string;
  isActive: boolean;
}

const RECOVERY_CHUNK_SIZE = 8_192;
const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 2;
const MAX_TERMINAL_COLS = 1000;
const MAX_TERMINAL_ROWS = 1000;

interface TerminalGridSize {
  cols: number;
  rows: number;
}

export function normalizeTerminalSize(cols: number, rows: number): TerminalGridSize | null {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
  return {
    cols: Math.max(MIN_TERMINAL_COLS, Math.min(Math.floor(cols), MAX_TERMINAL_COLS)),
    rows: Math.max(MIN_TERMINAL_ROWS, Math.min(Math.floor(rows), MAX_TERMINAL_ROWS)),
  };
}

export function calculateTerminalGridSize(
  width: number,
  height: number,
  charWidth: number,
  rowHeight: number,
): TerminalGridSize | null {
  if (width <= 0 || height <= 0 || charWidth <= 0 || rowHeight <= 0) return null;
  return normalizeTerminalSize(width / charWidth, height / rowHeight);
}

function sameTerminalSize(left: TerminalGridSize | null, right: TerminalGridSize): boolean {
  return left?.cols === right.cols && left.rows === right.rows;
}

function measureCellSize(element: HTMLElement): { charWidth: number; rowHeight: number } | null {
  const terminal = document.createElement("div");
  terminal.className = "wterm";
  terminal.style.position = "absolute";
  terminal.style.visibility = "hidden";
  terminal.style.pointerEvents = "none";
  const row = document.createElement("div");
  row.className = "term-row";
  const probe = document.createElement("span");
  probe.textContent = "W";
  row.appendChild(probe);
  terminal.appendChild(row);
  element.appendChild(terminal);
  const charWidth = probe.getBoundingClientRect().width;
  const rowHeight = row.getBoundingClientRect().height;
  terminal.remove();
  if (charWidth <= 0 || rowHeight <= 0) return null;
  return { charWidth, rowHeight };
}

export function areTerminalSessionPropsEqual(
  previous: TerminalSessionProps,
  next: TerminalSessionProps,
): boolean {
  return (
    previous.sessionId === next.sessionId &&
    previous.cwd === next.cwd &&
    previous.isActive === next.isActive
  );
}

export const TerminalSession = memo(function TerminalSession({
  sessionId,
  cwd,
  isActive,
}: TerminalSessionProps) {
  const [retryKey, setRetryKey] = useState(0);
  const hasBeenActiveRef = useRef(isActive);
  if (isActive) hasBeenActiveRef.current = true;

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden">
      {hasBeenActiveRef.current && (
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
}, areTerminalSessionPropsEqual);

TerminalSession.displayName = "TerminalSession";

interface TerminalInnerProps extends TerminalSessionProps {
  onRetry: () => void;
}

function TerminalInner({ sessionId, cwd, isActive, onRetry }: TerminalInnerProps) {
  const { ref, write } = useTerminal();
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isRecoveryComplete, setIsRecoveryComplete] = useState(false);
  const [gridSize, setGridSize] = useState<TerminalGridSize | null>(null);
  const mountedRef = useRef(true);
  const createdRef = useRef(false);
  const ptyReadyRef = useRef(false);
  const queuedInputRef = useRef("");
  const pendingSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const recoveryCompleteRef = useRef(false);
  const queuedLiveDataRef = useRef("");
  const exitDisplayedRef = useRef(false);
  const initialHistoryRef = useRef(
    useTerminalStore.getState().sessions.find((session) => session.id === sessionId)?.history ?? "",
  );
  const markRunning = useTerminalStore((state) => state.markRunning);
  const markError = useTerminalStore((state) => state.markError);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

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

  const handleReady = useCallback(() => setIsReady(true), []);

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
      const safeSize = normalizeTerminalSize(cols, rows);
      if (!safeSize) return;
      pendingSizeRef.current = safeSize;
      if (!ptyReadyRef.current) return;
      void window.omni.terminal.resize(sessionId, safeSize.cols, safeSize.rows).catch((err) => {
        console.error(`[Terminal Session] Failed to resize PTY ${sessionId}:`, err);
      });
    },
    [sessionId],
  );

  // Measure before WTerm mounts so the first rendered grid already matches the
  // panel. Visibility-hidden sessions retain layout, keeping this geometry
  // stable across switches without accepting zero-sized observations.
  useLayoutEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;

    let active = true;
    let cell = measureCellSize(host);
    const measure = (width: number, height: number) => {
      if (!active || width <= 0 || height <= 0) return;
      cell ??= measureCellSize(host);
      if (!cell) return;
      const safeSize = calculateTerminalGridSize(width, height, cell.charWidth, cell.rowHeight);
      if (!safeSize) return;

      pendingSizeRef.current = safeSize;
      setGridSize((current) => (sameTerminalSize(current, safeSize) ? current : safeSize));
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(host);
    const rect = host.getBoundingClientRect();
    measure(rect.width, rect.height);

    void document.fonts?.ready.then(() => {
      if (!active) return;
      cell = measureCellSize(host);
      const nextRect = host.getBoundingClientRect();
      measure(nextRect.width, nextRect.height);
    });

    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);

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

  // One shared IPC listener pair routes directly by session id. Keep each core
  // live while hidden so terminal protocol responses are never delayed.
  useEffect(() => {
    if (!isReady) return;
    return subscribeToTerminalEvents(sessionId, {
      onData(data) {
        if (recoveryCompleteRef.current) write(data);
        else queuedLiveDataRef.current += data;
      },
      onExit(payload) {
        if (exitDisplayedRef.current) return;
        exitDisplayedRef.current = true;
        write(`\r\n[Process completed (exit ${payload.exitCode})]\r\n`);
      },
    });
  }, [isReady, sessionId, write]);

  // Create only after recovery finishes, so fresh shell output cannot
  // interleave with recovered scrollback. The measured WTerm grid is sent as
  // part of creation, avoiding the old 80x24 spawn window.
  useEffect(() => {
    if (!core || !gridSize || !isReady || !isRecoveryComplete || createdRef.current) return;

    createdRef.current = true;
    const creationSize = gridSize;

    void window.omni.terminal
      .create(sessionId, cwd, creationSize.cols, creationSize.rows)
      .then(() => {
        if (!mountedRef.current) return;
        ptyReadyRef.current = true;
        markRunning(sessionId);
        const pendingSize = pendingSizeRef.current;
        if (
          pendingSize &&
          (pendingSize.cols !== creationSize.cols || pendingSize.rows !== creationSize.rows)
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
        if (!mountedRef.current) return;
        console.error("[Terminal Session] Failed to create backend PTY:", err);
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        markError(sessionId);
        write(`\r\nError: Failed to connect to shell backend. ${message}\r\n`);
      });
  }, [core, cwd, gridSize, isReady, isRecoveryComplete, markError, markRunning, sessionId, write]);

  useEffect(() => {
    if (!isReady || !isActive) return;
    const frameId = window.requestAnimationFrame(() => ref.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [isActive, isReady, ref]);

  useEffect(() => {
    if (isActive) return;
    ref.current?.instance?.element.querySelector("textarea")?.blur();
  }, [isActive, ref]);

  return (
    <div
      ref={terminalHostRef}
      className="relative flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {error ? (
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
      ) : !core || !gridSize ? (
        <div className="h-full w-full bg-surface-1" aria-label="Initializing terminal" />
      ) : (
        <Terminal
          ref={ref}
          cols={gridSize.cols}
          rows={gridSize.rows}
          core={core}
          autoResize={false}
          onData={handleData}
          onResize={handleResize}
          onReady={handleReady}
          onError={(err) => {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            markError(sessionId);
          }}
          data-terminal-cols={gridSize.cols}
          data-terminal-rows={gridSize.rows}
          style={{ height: "auto", width: "100%" }}
          className="min-h-0 min-w-0 flex-1 outline-none"
        />
      )}
    </div>
  );
}
