import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { List, PaperPlaneTilt, Plus, QrCode } from "@phosphor-icons/react";
import { Elevated } from "@/lib/elevated";
import { acknowledgeSubmission, submissionId } from "./submissions.ts";
import { PhoneMarkdown } from "./markdown.tsx";
import type {
  RemoteDiagnostics,
  RemoteModel,
  RemoteProject,
  RemoteReport,
  RemoteThreadSummary,
} from "../../contracts/remote.ts";

const TOKEN_KEY = "omni:remote-token";

class RemoteApiError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  const res = await fetch(path, {
    signal: AbortSignal.timeout(15_000),
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; retryable?: boolean };
    if (res.status === 401)
      throw new Error(
        "Pairing was rejected. Open History and pair again with the token from your Mac.",
      );
    throw new RemoteApiError(
      body.error ?? `Your Mac returned an error (${res.status}).`,
      body.retryable === true,
    );
  }
  return (await res.json()) as T;
}

export function RemoteApp() {
  const [projects, setProjects] = useState<RemoteProject[]>([]);
  const [models, setModels] = useState<RemoteModel[]>([]);
  const [threads, setThreads] = useState<RemoteThreadSummary[]>([]);
  const [projectId, setProjectId] = useState("");
  const [modelId, setModelId] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [report, setReport] = useState<RemoteReport | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const [draft, setDraft] = useState("");
  const [paired, setPaired] = useState(() => Boolean(localStorage.getItem(TOKEN_KEY)));
  const [tokenInput, setTokenInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendInflight = useRef(false);
  const [controlling, setControlling] = useState(false);
  const [diagnostics, setDiagnostics] = useState<RemoteDiagnostics | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [lastConnected, setLastConnected] = useState<number | null>(null);
  // Optimistic follow-up, scoped to its thread: `known` counts how many
  // identical user messages the report already had at send time, so a repeat
  // of an earlier message can't be "confirmed" by the old entry, and a fast
  // agent reply after the user entry still confirms (match anywhere, not tail).
  const [pending, setPending] = useState<{ text: string; threadId: string; known: number } | null>(
    null,
  );
  const [reportError, setReportError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Signature of the visible chat: scroll only when this actually changes,
  // and only when the user is already near the bottom (sticky-bottom).
  const chatSig = useRef("");
  const refreshInflight = useRef(false);

  // Scanned QR opens /remote#token=… — auto-save so scan = paired.
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/token=([A-Za-z0-9]+)/);
    if (match?.[1]) {
      localStorage.setItem(TOKEN_KEY, match[1]);
      setPaired(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!paired) return;
    // Poll overlap guard: a slow laptop must not stack concurrent refreshes.
    if (refreshInflight.current) return;
    refreshInflight.current = true;
    try {
      const [p, m, t, d] = await Promise.all([
        api<{ projects: RemoteProject[] }>("/api/remote/projects"),
        api<{ models: RemoteModel[] }>("/api/remote/models"),
        api<{ threads: RemoteThreadSummary[] }>("/api/remote/threads"),
        api<RemoteDiagnostics>("/api/remote/diagnostics"),
      ]);
      setDiagnostics(d);
      setLastConnected(Date.now());
      setProjects(p.projects);
      setModels(m.models);
      setThreads(t.threads);
      setLoadError(
        p.projects.length === 0 && m.models.length === 0
          ? "Add a Git project and select an installed coding agent in Pipper on your Mac."
          : null,
      );
    } catch (err) {
      setLoadError(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      refreshInflight.current = false;
    }
  }, [paired]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!activeId || !paired) return;
    // Poll while open so Running → Done + final text arrives with no stream.
    // Single-flight + generation: overlapping polls (each waits on a git
    // subprocess) must not regress the UI — only the newest wins, and a
    // failed poll keeps the last good report instead of blanking to Loading.
    const wanted = activeId;
    let cancelled = false;
    let generation = 0;
    let inflight = false;
    const load = async () => {
      if (inflight) return;
      inflight = true;
      const gen = ++generation;
      try {
        const r = await api<{ report: RemoteReport }>(`/api/remote/threads/${wanted}/report`);
        if (!cancelled && gen === generation) {
          setReport(r.report);
          setLastUpdated(Date.now());
          setReportError(null);
        }
      } catch (err) {
        if (!cancelled && gen === generation) {
          setReportError(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        inflight = false;
      }
    };
    setReport(null);
    setLastUpdated(null);
    setReportError(null);
    void load();
    const timer = setInterval(() => {
      void load();
      void refresh();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeId, paired, refresh]);

  const scanQr = async () => {
    setScanError(null);
    try {
      const Detector = (
        window as unknown as {
          BarcodeDetector?: new (opts: { formats: string[] }) => {
            detect(v: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
          };
        }
      ).BarcodeDetector;
      if (!Detector) {
        setScanError("Camera scan not supported here — paste the token instead.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      try {
        const video = document.createElement("video");
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({ formats: ["qr_code"] });
        const deadline = Date.now() + 30_000;
        let found: string | null = null;
        while (Date.now() < deadline && !found) {
          const codes = await detector.detect(video).catch(() => []);
          found = codes[0]?.rawValue ?? null;
          if (!found) await new Promise((r) => setTimeout(r, 300));
        }
        const token = found?.match(/token=([A-Za-z0-9]+)/)?.[1];
        if (token) {
          localStorage.setItem(TOKEN_KEY, token);
          setPaired(true);
        } else {
          setScanError("No QR found in 30s — try again or paste the token.");
        }
      } finally {
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch {
      setScanError("Camera unavailable — paste the token instead.");
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sendInflight.current || report?.running) return;
    sendInflight.current = true;
    setSending(true);
    setSendError(null);
    // Move the draft into the optimistic bubble immediately; on failure it
    // is restored below so nothing the user typed is ever lost.
    setDraft("");
    let submitted: { scope: string[]; id: string } | null = null;
    try {
      const scope = activeId ? ["prompt", activeId, text] : ["create", projectId, modelId, text];
      const requestId = submissionId(localStorage, scope);
      submitted = { scope, id: requestId };
      if (!activeId) {
        if (!projectId || !modelId) {
          setDraft(text);
          return;
        }
        const created = await api<{ thread: RemoteThreadSummary }>("/api/remote/threads", {
          method: "POST",
          body: JSON.stringify({ requestId, projectId, modelId, prompt: text }),
        });
        setActiveId(created.thread.id);
        setPending({ text, threadId: created.thread.id, known: 0 });
      } else {
        // Optimistic: show the bubble instantly; poll confirms delivery.
        const known = (report?.messages ?? []).filter(
          (m) => m.role === "user" && m.text === text,
        ).length;
        setPending({ text, threadId: activeId, known });
        await api(`/api/remote/threads/${activeId}/prompt`, {
          method: "POST",
          body: JSON.stringify({ requestId, prompt: text }),
        });
      }
      acknowledgeSubmission(localStorage, scope, requestId);
      void refresh();
    } catch (err) {
      if (submitted && err instanceof RemoteApiError && err.retryable) {
        acknowledgeSubmission(localStorage, submitted.scope, submitted.id);
      }
      setDraft(text);
      setPending(null);
      setSendError(`Send failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
      sendInflight.current = false;
    }
  };

  const control = async (decisionId?: string, optionId?: string) => {
    if (!activeId || controlling) return;
    const threadId = activeId;
    setControlling(true);
    setSendError(null);
    try {
      await api(`/api/remote/threads/${threadId}/${decisionId ? "permission" : "stop"}`, {
        method: "POST",
        body: JSON.stringify(decisionId ? { decisionId, optionId, cancelled: !optionId } : {}),
      });
      // Poll owns report updates, so a late response cannot overwrite another thread.
      void refresh();
    } catch (error) {
      setSendError(
        error instanceof Error
          ? error.message
          : "Couldn't reach your Mac. Check Tailscale and retry.",
      );
    } finally {
      setControlling(false);
    }
  };

  const newChat = () => {
    setActiveId(null);
    setReport(null);
    setPending(null);
    setSidebar(false);
  };

  // Drop the optimistic bubble once the server transcript incorporates the
  // send: a matching user entry beyond the pre-send count proves delivery.
  // Scoped to the destination thread so switching chats can't confirm it.
  const confirmedTail = report?.messages.at(-1);
  const pendingConfirmed =
    pending &&
    report &&
    pending.threadId === report.threadId &&
    report.messages.filter((m) => m.role === "user" && m.text === pending.text).length >
      pending.known;
  useEffect(() => {
    if (pendingConfirmed) setPending(null);
  }, [pendingConfirmed]);
  const pendingVisible =
    pending && !pendingConfirmed && pending.threadId === activeId ? pending.text : null;
  useEffect(() => {
    // Sticky-bottom: never yank a user who scrolled up to read. Only scroll
    // when the chat actually grew AND the user was already near the bottom
    // (or just switched chats / sent a message).
    const sig = [
      activeId,
      report?.messages.length ?? 0,
      confirmedTail?.text.length ?? 0,
      pendingVisible ?? "",
      report?.running ? "run" : "idle",
    ].join("|");
    if (sig === chatSig.current) return;
    const wasNewChat = chatSig.current.split("|")[0] !== String(activeId);
    chatSig.current = sig;
    const el = bodyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom || wasNewChat || pendingVisible) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [confirmedTail, pendingVisible, report?.running, report?.messages.length, activeId]);

  if (!paired) {
    return (
      <main className="pair-wrap">
        <h1>Pipper Remote</h1>
        <p>
          Keep Pipper open on your Mac and connect both devices to Tailscale. Paste the token from
          Settings → Remote access, or scan its QR.
        </p>
        <input
          className="pair-input"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="Pairing token"
          inputMode="text"
        />
        <button
          className="pair-btn"
          onClick={() => {
            localStorage.setItem(TOKEN_KEY, tokenInput.trim());
            setPaired(true);
          }}
        >
          Pair
        </button>
        <button className="pair-btn ghost" onClick={() => void scanQr()}>
          <QrCode size={18} style={{ verticalAlign: "-3px" }} /> Scan QR instead
        </button>
        {scanError && <p className="notice bad">{scanError}</p>}
      </main>
    );
  }

  return (
    <div className="remote-shell">
      <header className="remote-header">
        <button
          className="header-btn"
          aria-label="History"
          disabled={sending}
          onClick={() => setSidebar(true)}
        >
          <List size={22} />
        </button>
        <span className="header-spacer" />
        <button className="header-btn" aria-label="New chat" disabled={sending} onClick={newChat}>
          <Plus size={22} />
        </button>
      </header>

      <AnimatePresence>
        {sidebar && (
          <>
            <motion.div
              className="remote-sheet-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={() => setSidebar(false)}
            />
            <motion.aside
              className="remote-sheet"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.24, bounce: 0.12 }}
              onClick={(e) => e.stopPropagation()}
            >
              {threads.length > 0 ? (
                threads.map((t) => (
                  <button
                    key={t.id}
                    className={`thread-row${t.id === activeId ? " active" : ""}${t.running ? " running" : ""}`}
                    onClick={() => {
                      setActiveId(t.id);
                      setSidebar(false);
                    }}
                  >
                    {t.title ?? t.id.slice(0, 8)}
                  </button>
                ))
              ) : (
                <p className="remote-hint">No work yet — start a chat with ＋</p>
              )}
              <button
                className="unpair-btn"
                onClick={() => {
                  localStorage.removeItem(TOKEN_KEY);
                  setPaired(false);
                }}
              >
                Unpair / enter new token
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="remote-body" ref={bodyRef}>
        {loadError && (
          <p className="notice bad">
            {loadError} Keep Pipper open and check Tailscale on both devices.
          </p>
        )}
        {!activeId && (
          <section aria-label="Connection checks">
            <button className="pair-btn ghost" onClick={() => void refresh()}>
              Test connection
            </button>
            {lastConnected && (
              <p className="remote-hint">
                Last connected {new Date(lastConnected).toLocaleTimeString()}
              </p>
            )}
            {diagnostics && (
              <p className="remote-hint">
                Pairing accepted · {diagnostics.agentReady ? "Pipper ready" : "Pipper starting"} ·{" "}
                {diagnostics.availableAgents} available agents · {diagnostics.projects} projects
              </p>
            )}
            {diagnostics?.availableAgents === 0 && (
              <p className="notice warn">Install and select an agent in Pipper on your Mac.</p>
            )}
            {diagnostics?.projects === 0 && (
              <p className="notice warn">Add a Git project in Pipper on your Mac.</p>
            )}
            <button
              className="pair-btn ghost"
              disabled={
                !projectId ||
                !modelId ||
                !!loadError ||
                !diagnostics?.agentReady ||
                !diagnostics.availableAgents
              }
              onClick={() =>
                setDraft(
                  "Describe this project's purpose in one sentence. Do not change files or run commands.",
                )
              }
            >
              Prepare a sample task
            </button>
          </section>
        )}
        {!activeId ? (
          <>
            <div className="remote-card picker-group">
              <select
                className="remote-select"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                aria-label="Project"
              >
                <option value="">Project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                className="remote-select"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                aria-label="Model"
              >
                <option value="">Model…</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="remote-hint">
              Pick both, then type below — a fresh workspace is created automatically.
            </p>
          </>
        ) : (
          <div className="chat">
            {!report ? (
              <p className="report-status">{reportError ?? "Loading…"}</p>
            ) : (
              <>
                {reportError && (
                  <p className="notice warn">
                    {reportError} Showing the last update; check Tailscale and keep Pipper open on
                    your Mac.
                  </p>
                )}
                <details className="remote-card thread-meta">
                  <summary>
                    {report.permissions?.length
                      ? "Needs your input"
                      : report.running
                        ? "Running on laptop…"
                        : "Not running"}
                    {report.projectName ? ` · ${report.projectName}` : ""}
                  </summary>
                  {report.summary && <p className="report-summary">{report.summary}</p>}
                  {!report.isolated && (
                    <p className="notice warn">
                      Ran in project root — no isolated workspace.
                      {report.isolationNote ? ` Reason: ${report.isolationNote}` : ""}
                    </p>
                  )}
                  {report.worktreePath && (
                    <p className="ws-path">workspace: {report.worktreePath}</p>
                  )}
                  {report.filesTouched.length > 0 && (
                    <ul className="file-list">
                      {report.filesTouched.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  )}
                </details>
                {lastUpdated && (
                  <p className="remote-hint">
                    Updated {new Date(lastUpdated).toLocaleTimeString()}
                  </p>
                )}
                {report.request?.error && <p className="notice bad">{report.request.error}</p>}
                {report.permissions?.map((decision) => (
                  <Elevated offset={2} key={decision.id} className="remote-decision">
                    <h3>{decision.title}</h3>
                    {decision.detail && <pre>{decision.detail}</pre>}
                    {decision.options.map((option) => (
                      <button
                        className="pair-btn ghost"
                        key={option.optionId}
                        disabled={controlling || !!reportError}
                        onClick={() => void control(decision.id, option.optionId)}
                      >
                        {option.name}
                      </button>
                    ))}
                    <button
                      className="pair-btn ghost"
                      disabled={controlling || !!reportError}
                      onClick={() => void control(decision.id)}
                    >
                      Dismiss request
                    </button>
                  </Elevated>
                ))}
                {(report.running || !!report.permissions?.length) && (
                  <button
                    className="pair-btn ghost"
                    disabled={controlling}
                    onClick={() => void control()}
                  >
                    Stop this thread
                  </button>
                )}
                {report.messages.length === 0 && !pendingVisible && (
                  <p className="remote-hint">Waiting for the first reply…</p>
                )}
                {report.messages.map((m, i) => (
                  <div
                    // eslint-disable-next-line react/no-array-index-key
                    key={`${i}-${m.role}-${m.text.slice(0, 24)}`}
                    className={`bubble ${m.role === "user" ? "me" : "agent"}`}
                  >
                    {m.role === "user" ? <p>{m.text}</p> : <PhoneMarkdown text={m.text} />}
                  </div>
                ))}
                {pendingVisible && (
                  <div className="bubble me pending">
                    <p>{pendingVisible}</p>
                    <span className="bubble-state">
                      {sending ? "Sending…" : "Sent · waiting for laptop…"}
                    </span>
                  </div>
                )}
                {report.running && (
                  <div className="bubble agent working">
                    <span className="dots" aria-label="Working">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                )}
                {!report.running && !report.finalText && report.messages.length > 0 && (
                  <p className="report-status">Not running</p>
                )}
                <div ref={bottomRef} />
              </>
            )}
          </div>
        )}
      </div>
      {sendError && (
        <p className="notice bad" style={{ margin: "0 16px 8px" }}>
          {sendError}
        </p>
      )}

      <footer className="remote-composer">
        <div className="composer-bar">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={!activeId ? "Pick project + model first…" : "Follow up…"}
            disabled={!activeId && (!projectId || !modelId)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
          />
          <motion.button
            className="composer-send"
            onClick={() => void send()}
            aria-label="Send"
            disabled={!draft.trim() || sending || report?.running === true}
            whileTap={{ scale: 0.9 }}
            transition={{ duration: 0.08 }}
          >
            <PaperPlaneTilt size={20} weight="fill" />
          </motion.button>
        </div>
      </footer>
    </div>
  );
}
