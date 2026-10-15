// Serialized into a disposable instrumented Electron build. No production import.
export function installArchitectureProbe(api) {
  const als = new api.AsyncLocalStorage();
  let stage = null;
  let nextId = 0;
  const records = [];
  const totals = new Map();
  const patches = [];
  const now = () => performance.now();
  const small = (value) =>
    typeof value === "string"
      ? value
          .replaceAll(process.env.PIPPER_DEV_USER_DATA_PATH ?? "__none__", "<userdata>")
          .slice(0, 180)
      : null;
  function record(name, started, error, detail, parent, traced, capturedStage) {
    const ms = now() - started;
    const key = `${capturedStage}\0${name}\0${detail ?? ""}`;
    const row = totals.get(key) ?? {
      stage: capturedStage,
      name,
      detail,
      calls: 0,
      totalMs: 0,
      maxMs: 0,
      errors: 0,
    };
    row.calls++;
    row.totalMs += ms;
    row.maxMs = Math.max(row.maxMs, ms);
    row.errors += Number(error);
    totals.set(key, row);
    if (traced)
      records.push({ stage: capturedStage, id: traced, parent, name, detail, started, ms, error });
  }
  function wrap(object, key, name, options = {}) {
    const original = object?.[key];
    if (typeof original !== "function") return;
    const replacement = function (...args) {
      if (!stage) return original.apply(this, args);
      const capturedStage = stage;
      const started = now();
      const parent = als.getStore() ?? null;
      const traced = options.trace ? ++nextId : null;
      const detail = options.detail ? options.detail(args) : null;
      const execute = () => {
        try {
          const result = original.apply(this, args);
          if (result && typeof result.then === "function") {
            return result.then(
              (value) => {
                record(name, started, false, detail, parent, traced, capturedStage);
                return value;
              },
              (error) => {
                record(name, started, true, detail, parent, traced, capturedStage);
                throw error;
              },
            );
          }
          record(name, started, false, detail, parent, traced, capturedStage);
          return result;
        } catch (error) {
          record(name, started, true, detail, parent, traced, capturedStage);
          throw error;
        }
      };
      return traced ? als.run(traced, execute) : execute();
    };
    object[key] = replacement;
    if (!options.requestScoped)
      patches.push(() => {
        object[key] = original;
      });
  }
  const manager = api.getManager();
  for (const key of [
    "createThread",
    "createThreadInternal",
    "switchThread",
    "switchThreadInternal",
    "switchThreadCore",
    "sessionNew",
    "sessionLoad",
    "sessionResume",
    "ensureConnection",
    "switchAgent",
    "acquireConnection",
    "sendPrompt",
    "sendPromptInternal",
    "requestPrompt",
    "closeThreadSession",
    "closeThreadSessionInternal",
    "flushThreadSnapshot",
    "flushRuntimeSnapshot",
    "getToolCalls",
    "setThreadConfigOption",
    "getModelCatalogs",
  ])
    wrap(manager, key, `manager.${key}`, { trace: true });
  for (const key of [
    "handleSessionUpdate",
    "syncToolPayloads",
    "emitRunningThreads",
    "pushState",
    "buildSessionState",
    "queueSnapshotWrite",
  ])
    wrap(manager, key, `manager.${key}`);
  for (const [owner, keys] of [
    [
      "snapshotStore",
      ["load", "loadPayloads", "write", "enforceLimit", "cleanupOrphans", "preload"],
    ],
    ["lifecycle", ["acquire", "spawnAndInitialize", "close"]],
    ["prompts", ["send", "enqueue"]],
  ])
    for (const key of keys) wrap(manager[owner], key, `${owner}.${key}`, { trace: true });
  wrap(manager.broadcaster.deps, "send", "IPC.send", {
    trace: true,
    detail: ([channel, payload]) => `${channel}:${payload?.type ?? "other"}`,
  });
  wrap(api.cp, "execFileSync", "child.execFileSync", {
    detail: ([command, args]) => `${small(command)} ${(args ?? []).slice(0, 3).join(" ")}`,
  });
  wrap(api.cp, "spawn", "child.spawn", {
    detail: ([command, args]) => `${small(command)} ${(args ?? []).slice(0, 2).join(" ")}`,
  });
  for (const key of [
    "readFileSync",
    "writeFileSync",
    "readdirSync",
    "realpathSync",
    "statSync",
    "lstatSync",
    "renameSync",
    "mkdirSync",
    "existsSync",
  ])
    wrap(api.fs, key, `fs.${key}`, {
      detail: ([path]) => small(String(path).split(/[\\/]/).at(-1)),
    });
  for (const key of ["readFile", "writeFile", "mkdir", "rename", "stat", "unlink"])
    wrap(api.fsp, key, `fs.async.${key}`, {
      detail: ([path]) => small(String(path).split(/[\\/]/).at(-1)),
    });
  api.syncBuiltinESMExports();
  const db = api.getDb();
  const prepare = db.prepare;
  db.prepare = function (sql, ...args) {
    const statement = prepare.call(this, sql, ...args);
    const detail = sql.replace(/\s+/g, " ").slice(0, 180);
    for (const key of ["run", "get", "all"])
      wrap(statement, key, `SQL.${key}`, { detail: () => detail, requestScoped: true });
    return statement;
  };
  patches.push(() => {
    db.prepare = prepare;
  });
  return {
    begin(name) {
      stage = name;
      return now();
    },
    end() {
      stage = null;
    },
    clear() {
      records.length = 0;
      totals.clear();
    },
    read() {
      return {
        records: [...records],
        totals: [...totals.values()],
        memory: process.memoryUsage(),
        residentSessions: manager.sessions.size,
        connections: manager.lifecycle
          .all()
          .map((live) => ({ agentId: live.agentId, pid: live.process.pid })),
        snapshotCache: manager.snapshotStore.memoryCacheStats(),
      };
    },
    setSelectedAgentIds: api.setSelectedAgentIds,
    manager,
    stop() {
      stage = null;
      for (const undo of patches.reverse()) undo();
      api.syncBuiltinESMExports();
    },
  };
}
