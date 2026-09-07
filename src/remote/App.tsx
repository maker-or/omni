import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { List, PaperPlaneTilt, Plus, QrCode } from "@phosphor-icons/react";
import { PhoneMarkdown } from "./markdown.tsx";
import type {
  RemoteModel,
  RemoteProject,
  RemoteReport,
  RemoteThreadSummary,
} from "../../contracts/remote.ts";

const TOKEN_KEY = "omni:remote-token";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} → ${res.status} ${text.slice(0, 200)}`);
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
      const [p, m, t] = await Promise.all([
        api<{ projects: RemoteProject[] }>("/api/remote/projects"),
        api<{ models: RemoteModel[] }>("/api/remote/models"),
        api<{ threads: RemoteThreadSummary[] }>("/api/remote/threads"),
      ]);
      setProjects(p.projects);
      setModels(m.models);
      setThreads(t.threads);
      setLoadError(
        p.projects.length === 0 && m.models.length === 0
          ? "Connected, but laptop returned 0 projects and 0 models. Check laptop console for [Remote] lines."
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
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    // Move the draft into the optimistic bubble immediately; on failure it
    // is restored below so nothing the user typed is ever lost.
    setDraft("");
    try {
      if (!activeId) {
        if (!projectId || !modelId) {
          setDraft(text);
          return;
        }
        const created = await api<{ thread: RemoteThreadSummary }>("/api/remote/threads", {
          method: "POST",
          body: JSON.stringify({ projectId, modelId, prompt: text }),
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
          body: JSON.stringify({ prompt: text }),
        });
      }
      void refresh();
    } catch (err) {
      setDraft(text);
      setPending(null);
      setSendError(`Send failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
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
        <h1>Omni Remote</h1>
        <p>Paste the pairing token from the laptop terminal, or scan its QR.</p>
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
        <button className="header-btn" aria-label="History" onClick={() => setSidebar(true)}>
          <List size={22} />
        </button>
        <span className="header-spacer" />
        <button className="header-btn" aria-label="New chat" onClick={newChat}>
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
        {loadError && <p className="notice bad">{loadError}</p>}
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
                  <p className="notice warn">Couldn't refresh — showing last update.</p>
                )}
                <details className="remote-card thread-meta">
                  <summary>
                    {report.running ? "Running on laptop…" : "Done"}
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
                  <p className="report-status">Done</p>
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
            disabled={!draft.trim() || sending}
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
