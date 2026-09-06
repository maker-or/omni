import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { List, PaperPlaneTilt, Plus, QrCode } from "@phosphor-icons/react";
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
    // Stale guard: ignore a report that resolves after switching chats.
    const wanted = activeId;
    let cancelled = false;
    setReport(null);
    api<{ report: RemoteReport }>(`/api/remote/threads/${wanted}/report`)
      .then((r) => {
        if (!cancelled) setReport(r.report);
      })
      .catch(() => {
        if (!cancelled) setReport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, paired, threads]);

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
    try {
      if (!activeId) {
        if (!projectId || !modelId) return;
        const created = await api<{ thread: RemoteThreadSummary }>("/api/remote/threads", {
          method: "POST",
          body: JSON.stringify({ projectId, modelId, prompt: text }),
        });
        setActiveId(created.thread.id);
      } else {
        await api(`/api/remote/threads/${activeId}/prompt`, {
          method: "POST",
          body: JSON.stringify({ prompt: text }),
        });
      }
      // Clear only on success so a failed send keeps the draft for retry.
      setDraft("");
      void refresh();
    } catch (err) {
      setSendError(`Send failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
  };

  const newChat = () => {
    setActiveId(null);
    setReport(null);
    setSidebar(false);
  };

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
        <button className="icon-btn" aria-label="History" onClick={() => setSidebar(true)}>
          <List size={22} />
        </button>
        <h1>Omni Remote</h1>
        <button className="icon-btn" aria-label="New chat" onClick={newChat}>
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

      <div className="remote-body">
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
          <div className="remote-card">
            {!report ? (
              <p className="report-status">Loading…</p>
            ) : (
              <>
                <p className="report-status">{report.running ? "Running on laptop…" : "Done"}</p>
                {report.summary && <p className="report-summary">{report.summary}</p>}
                {!report.isolated && (
                  <p className="notice warn">
                    Ran in project root — no isolated workspace.
                    {report.isolationNote ? ` Reason: ${report.isolationNote}` : ""}
                  </p>
                )}
                {report.worktreePath && <p className="ws-path">workspace: {report.worktreePath}</p>}
                {report.filesTouched.length > 0 && (
                  <ul className="file-list">
                    {report.filesTouched.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
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
          className="send-btn"
          onClick={() => void send()}
          aria-label="Send"
          disabled={!draft.trim()}
          whileTap={{ scale: 0.9 }}
          transition={{ duration: 0.08 }}
        >
          <PaperPlaneTilt size={22} weight="fill" />
        </motion.button>
      </footer>
    </div>
  );
}
