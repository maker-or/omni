export interface TerminalDataPayload {
  sessionId: string;
  data: string;
}

export interface TerminalExitPayload {
  sessionId: string;
  exitCode: number;
  signal?: number;
}

interface TerminalEventSource {
  onData: (callback: (payload: TerminalDataPayload) => void) => () => void;
  onExit: (callback: (payload: TerminalExitPayload) => void) => () => void;
}

interface TerminalEventHandlers {
  onData: (data: string) => void;
  onExit: (payload: TerminalExitPayload) => void;
}

export function createTerminalEventRouter(source: TerminalEventSource) {
  const handlersBySession = new Map<string, TerminalEventHandlers>();
  let stopData: (() => void) | null = null;
  let stopExit: (() => void) | null = null;

  const start = () => {
    if (stopData || stopExit) return;
    stopData = source.onData((payload) => {
      handlersBySession.get(payload.sessionId)?.onData(payload.data);
    });
    stopExit = source.onExit((payload) => {
      handlersBySession.get(payload.sessionId)?.onExit(payload);
    });
  };

  const stopIfIdle = () => {
    if (handlersBySession.size > 0) return;
    stopData?.();
    stopExit?.();
    stopData = null;
    stopExit = null;
  };

  return {
    subscribe(sessionId: string, handlers: TerminalEventHandlers): () => void {
      handlersBySession.set(sessionId, handlers);
      start();
      return () => {
        if (handlersBySession.get(sessionId) !== handlers) return;
        handlersBySession.delete(sessionId);
        stopIfIdle();
      };
    },
  };
}

let sharedRouter: ReturnType<typeof createTerminalEventRouter> | null = null;

export function subscribeToTerminalEvents(
  sessionId: string,
  handlers: TerminalEventHandlers,
): () => void {
  sharedRouter ??= createTerminalEventRouter(window.omni.terminal);
  return sharedRouter.subscribe(sessionId, handlers);
}
