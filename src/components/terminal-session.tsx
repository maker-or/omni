import { useEffect, useState, useRef } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";
import { useTerminalStore } from "@/store/terminal-store";

interface TerminalSessionProps {
  sessionId: string;
  cwd?: string;
}

export function TerminalSession({ sessionId, cwd }: TerminalSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });

    observer.observe(el);

    // Initial check
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({ width: rect.width, height: rect.height });
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full overflow-hidden">
      {dimensions ? (
        <TerminalInner sessionId={sessionId} cwd={cwd} />
      ) : (
        <div className="h-full w-full flex items-center justify-center text-neutral-400 font-mono text-sm">
          Measuring layout…
        </div>
      )}
    </div>
  );
}

interface TerminalInnerProps {
  sessionId: string;
  cwd?: string;
}

function TerminalInner({ sessionId, cwd }: TerminalInnerProps) {
  const { ref, write } = useTerminal();
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const createdRef = useRef(false);
  const writtenLengthRef = useRef(0);

  const history = useTerminalStore((state) => {
    const session = state.sessions.find((s) => s.id === sessionId);
    return session ? session.history : "";
  });

  // Load GhosttyCore asynchronously for this session
  useEffect(() => {
    let active = true;
    GhosttyCore.load({ wasmPath: "./ghostty-vt.wasm" })
      .then((loadedCore) => {
        if (active) {
          setCore(loadedCore);
        }
      })
      .catch((err) => {
        console.error("Failed to load GhosttyCore:", err);
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      active = false;
    };
  }, []);

  // Write new history text reactively as it updates in the store
  useEffect(() => {
    if (!isReady || !history) return;
    const newText = history.slice(writtenLengthRef.current);
    if (newText) {
      write(newText);
      writtenLengthRef.current = history.length;
    }
  }, [history, isReady, write]);

  // Initialize the backend PTY process and bind to its events only when both core and terminal are ready
  useEffect(() => {
    if (!core || !isReady) {
      return;
    }

    console.log(
      `[Terminal Session] Terminal ready. Initializing PTY session ${sessionId} - CWD: ${cwd}`,
    );

    if (!createdRef.current) {
      createdRef.current = true;
      console.log("Connecting to shell process..");

      window.omni.terminal
        .create(sessionId, cwd)
        .then(() => {
          console.log("[Terminal Session] Backend PTY created/reused successfully.");
        })
        .catch((err) => {
          console.error("[Terminal Session] Failed to create backend PTY:", err);
          setError(err instanceof Error ? err.message : String(err));
          write(
            `\r\nError: Failed to connect to shell backend. ${err instanceof Error ? err.message : String(err)}\r\n`,
          );
        });
    }

    // Subscribe to shell exit events
    const unsubscribeExit = window.omni.terminal.onExit((payload) => {
      if (payload.sessionId === sessionId) {
        console.log("[Terminal Session] Shell process exited.");
        write("\r\n[Process completed]\r\n");
      }
    });

    return () => {
      unsubscribeExit();
    };
  }, [core, isReady, sessionId, cwd, write]);

  // Handle keyboard inputs
  const handleData = (data: string) => {
    window.omni.terminal.write(sessionId, data);
  };

  // Handle grid size changes
  const handleResize = (cols: number, rows: number) => {
    window.omni.terminal.resize(sessionId, cols, rows);
  };

  // Focus the terminal when it is ready
  useEffect(() => {
    if (isReady) {
      const timer = setTimeout(() => {
        ref.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isReady]);

  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center text-red-500 font-mono text-sm p-4">
        Error loading terminal: {error}
      </div>
    );
  }

  if (!core) {
    return (
      <div className="h-full w-full flex items-center justify-center text-neutral-400 font-mono text-sm">
        Initializing Ghostty Core…
      </div>
    );
  }

  return (
    <Terminal
      ref={ref}
      core={core}
      autoResize={true}
      onData={handleData}
      onResize={handleResize}
      onReady={() => setIsReady(true)}
      className="h-full w-full outline-none"
    />
  );
}
