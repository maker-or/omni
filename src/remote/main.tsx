import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RemoteApp } from "./App.tsx";
import { readToken } from "./api.ts";
import "./remote.css";

function postLog(message: string): void {
  try {
    // The log endpoint requires the pairing token; an unpaired phone only
    // shows the error on screen.
    const token = readToken();
    if (!token) return;
    void fetch("/api/remote/debug-log", {
      method: "POST",
      headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}` },
      body: message,
    });
  } catch {
    /* offline */
  }
}

function showFatal(message: string): void {
  postLog(`FATAL: ${message}`);
  const el = document.getElementById("remote-debug");
  if (el) {
    el.style.display = "block";
    el.textContent += `\n${message}`;
  }
}

window.addEventListener("error", (e) => {
  showFatal(`error: ${e.message} @ ${e.filename}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  showFatal(`rejection: ${String(e.reason)}`);
});

try {
  createRoot(document.getElementById("remote-root")!).render(
    <StrictMode>
      <RemoteApp />
    </StrictMode>,
  );
} catch (err) {
  showFatal(`mount: ${String(err)}`);
}
