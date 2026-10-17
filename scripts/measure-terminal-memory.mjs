#!/usr/bin/env node
/**
 * Measure what open workspace terminals retain, for 0/10/20 terminals (R29).
 *
 *   node --expose-gc scripts/measure-terminal-memory.mjs [counts=0,10,20]
 *
 * Components, each measured in isolation with the production packages:
 * - shells: login shells spawned through node-pty exactly as main's
 *   `terminal:create` does; process-tree RSS from `ps` after startup.
 * - cores: one Ghostty WASM core per viewed terminal (as TerminalSession
 *   loads them), idle and after ~4 MiB of colored output each. Reports
 *   reserved linear memory and the Node RSS delta.
 * - view: DOM elements a saturated WTerm view keeps while hidden (happy-dom
 *   element count; Chromium bytes are not measured here).
 * - history: the renderer plain-text history cap per session.
 *
 * Not measured: actual Electron renderer RSS/paint. Each count runs in a
 * fresh child process so earlier allocations do not leak into later ones.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmFile = join(root, "node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
const SCROLLBACK_LIMIT_BYTES = 1024 * 1024; // GHOSTTY_SCROLLBACK_LIMIT_BYTES
const MAX_HISTORY_CHARS = 200_000; // terminal-store MAX_HISTORY_CHARS
const COLS = 160;
const ROWS = 48;
const mib = (bytes) => +(bytes / 2 ** 20).toFixed(2);
const outputLine = (i) =>
  `\x1b[32m${String(i).padStart(6, "0")}\x1b[0m ${"build output ".repeat(8)}\r\n`;

function stubWasmFetch() {
  const bytes = readFileSync(wasmFile);
  globalThis.fetch = async () => new Response(bytes, { status: 200 });
}

async function measureShells(count) {
  const pty = createRequire(join(root, "package.json"))("node-pty");
  const shell = process.env.SHELL || "/bin/zsh";
  const children = [];
  for (let i = 0; i < count; i++) {
    const child = pty.spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols: COLS,
      rows: ROWS,
      cwd: process.env.HOME,
      env: { ...process.env, TERM: "xterm-256color" },
    });
    child.onData(() => {});
    children.push(child);
  }
  try {
    await new Promise((resolve) => setTimeout(resolve, count ? 6000 : 0));
    const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss="])
      .toString()
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number));
    const rss = new Map(rows.map(([pid, , kib]) => [pid, kib]));
    const childrenOf = new Map();
    for (const [pid, ppid] of rows) childrenOf.set(ppid, [...(childrenOf.get(ppid) ?? []), pid]);
    let kib = 0;
    let processes = 0;
    for (const child of children) {
      const stack = [child.pid];
      while (stack.length) {
        const pid = stack.pop();
        if (!rss.has(pid)) continue;
        kib += rss.get(pid);
        processes += 1;
        stack.push(...(childrenOf.get(pid) ?? []));
      }
    }
    return { shell, processes, rssMiB: mib(kib * 1024) };
  } finally {
    for (const child of children) child.kill();
  }
}

async function measureCores(count) {
  stubWasmFetch();
  const { GhosttyCore } = await import("@wterm/ghostty");
  const rss = () => {
    globalThis.gc?.();
    return process.memoryUsage().rss;
  };
  const before = rss();
  const cores = [];
  for (let i = 0; i < count; i++) {
    const core = await GhosttyCore.load({
      wasmPath: "ghostty-vt.wasm",
      scrollbackLimit: SCROLLBACK_LIMIT_BYTES,
    });
    core.init(COLS, ROWS);
    cores.push(core);
  }
  const reserved = () =>
    cores.reduce((sum, core) => sum + core.wasm.instance.exports.memory.buffer.byteLength, 0);
  const idle = { reservedMiB: mib(reserved()), rssDeltaMiB: mib(rss() - before) };
  for (const core of cores) for (let i = 0; i < 30_000; i++) core.writeString(outputLine(i));
  const saturated = { reservedMiB: mib(reserved()), rssDeltaMiB: mib(rss() - before) };
  return { idle, saturated, scrollbackRows: cores[0]?.getScrollbackCount() ?? 0 };
}

async function measureHiddenView() {
  const { Window } = await import("happy-dom");
  const window = new Window({ width: 1280, height: 900 });
  for (const key of [
    "window",
    "document",
    "HTMLElement",
    "Node",
    "navigator",
    "getComputedStyle",
  ]) {
    const value = window[key];
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: typeof value === "function" && !/^[A-Z]/.test(key) ? value.bind(window) : value,
    });
  }
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  stubWasmFetch();
  const { GhosttyCore } = await import("@wterm/ghostty");
  const { WTerm } = await import("@wterm/dom");
  const element = document.createElement("div");
  document.body.appendChild(element);
  const core = await GhosttyCore.load({
    wasmPath: "ghostty-vt.wasm",
    scrollbackLimit: SCROLLBACK_LIMIT_BYTES,
  });
  const term = new WTerm(element, { core, cols: COLS, rows: ROWS });
  await term.init();
  for (let i = 0; i < 30_000; i++) term.write(outputLine(i));
  await new Promise((resolve) => setTimeout(resolve, 300));
  return {
    elements: element.querySelectorAll("*").length,
    rows: element.querySelectorAll(".term-row").length,
    textChars: element.textContent.length,
  };
}

async function child(count) {
  const result = { count, shells: await measureShells(count), cores: await measureCores(count) };
  console.log(JSON.stringify(result));
  process.exit(0);
}

if (process.argv[2] === "--child") {
  await child(Number(process.argv[3]));
} else {
  const counts = (process.argv[2] ?? "0,10,20").split(",").map(Number);
  const results = counts.map((count) => {
    const run = spawnSync(
      process.execPath,
      ["--expose-gc", fileURLToPath(import.meta.url), "--child", String(count)],
      { cwd: root, encoding: "utf8" },
    );
    if (run.status !== 0) throw new Error(run.stderr || `measurement for ${count} failed`);
    return JSON.parse(run.stdout.trim().split("\n").at(-1));
  });
  const hiddenView = await measureHiddenView();
  console.log(
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        grid: `${COLS}x${ROWS}`,
        historyCapChars: MAX_HISTORY_CHARS,
        results,
        hiddenView,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
