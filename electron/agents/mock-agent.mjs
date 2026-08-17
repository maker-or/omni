#!/usr/bin/env node
/**
 * Minimal ACP agent over stdio (ndjson JSON-RPC) for development and tests.
 * Implements initialize, session lifecycle, prompt, cancel, and set_config_option.
 */
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";

const PROTOCOL_VERSION = 1;

/** @type {Map<string, { id: string, cwd: string, title: string | null, configOptions: any[], cancelled: boolean }>} */
const sessions = new Map();

const defaultConfigOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "mock-fast",
    options: [
      { value: "mock-fast", name: "Mock Fast" },
      { value: "mock-smart", name: "Mock Smart" },
    ],
  },
  {
    id: "thought_level",
    name: "Thinking",
    category: "thought_level",
    type: "select",
    currentValue: "medium",
    options: [
      { value: "off", name: "Off" },
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
];

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function writeWithBackpressure(msg) {
  if (process.stdout.write(JSON.stringify(msg) + "\n")) return;
  await new Promise((resolve) => process.stdout.once("drain", resolve));
}

async function writeRawLine(line) {
  const payload = line.endsWith("\n") ? line : `${line}\n`;
  if (process.stdout.write(payload)) return;
  await new Promise((resolve) => process.stdout.once("drain", resolve));
}

/**
 * Swap the fixture session id without parse+stringify of the 200 MiB body.
 * Fixture lines are `{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"...","update":...}}`.
 */
export function rewriteFixtureSessionId(line, sessionId) {
  return line.replace(/"sessionId"\s*:\s*"[^"]*"/, `"sessionId":${JSON.stringify(sessionId)}`);
}

function respond(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

function notify(method, params) {
  write({ jsonrpc: "2.0", method, params });
}

function sessionUpdate(sessionId, update) {
  notify("session/update", { sessionId, update });
}

async function replayBenchmarkFixture(sessionId, fixturePath) {
  const input = createReadStream(fixturePath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let updates = 0;
  for await (const line of lines) {
    if (!line.includes('"session/update"')) continue;
    await writeRawLine(rewriteFixtureSessionId(line, sessionId));
    updates += 1;
  }
  process.stderr.write(`[benchmark] replayed ${updates} updates from ${fixturePath}\n`);
}

function textFromPrompt(prompt) {
  if (!Array.isArray(prompt)) return "";
  return prompt
    .map((block) => {
      if (block?.type === "text") return block.text ?? "";
      if (block?.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

async function handlePrompt(id, params) {
  const session = sessions.get(params.sessionId);
  if (!session) {
    respondError(id, -32001, "Session not found");
    return;
  }
  session.cancelled = false;
  const userText = textFromPrompt(params.prompt);
  const msgId = randomUUID();
  const thoughtId = msgId;

  sessionUpdate(params.sessionId, {
    sessionUpdate: "agent_thought_chunk",
    messageId: thoughtId,
    content: { type: "text", text: "Considering the request… " },
  });

  await sleep(20);
  if (session.cancelled) {
    respond(id, { stopReason: "cancelled" });
    return;
  }

  const toolId = randomUUID();
  sessionUpdate(params.sessionId, {
    sessionUpdate: "tool_call",
    toolCallId: toolId,
    title: "Read project context",
    kind: "read",
    status: "pending",
  });
  sessionUpdate(params.sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId: toolId,
    status: "in_progress",
  });
  await sleep(15);
  sessionUpdate(params.sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId: toolId,
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "context ok" } }],
  });

  sessionUpdate(params.sessionId, {
    sessionUpdate: "plan",
    entries: [
      { content: "Understand the request", priority: "high", status: "completed" },
      { content: "Reply to the user", priority: "medium", status: "in_progress" },
    ],
  });

  sessionUpdate(params.sessionId, {
    sessionUpdate: "agent_message_chunk",
    messageId: msgId,
    content: {
      type: "text",
      text: userText ? `Echo: ${userText}` : "Hello from Pipper mock agent.",
    },
  });

  sessionUpdate(params.sessionId, {
    sessionUpdate: "usage_update",
    used: 120,
    size: 128000,
    cost: { amount: 0.001, currency: "USD" },
  });

  if (!session.title) {
    const title = userText.slice(0, 48) || "New conversation";
    session.title = title;
    sessionUpdate(params.sessionId, {
      sessionUpdate: "session_info_update",
      title,
    });
  }

  sessionUpdate(params.sessionId, {
    sessionUpdate: "plan",
    entries: [
      { content: "Understand the request", priority: "high", status: "completed" },
      { content: "Reply to the user", priority: "medium", status: "completed" },
    ],
  });

  if (session.cancelled) {
    respond(id, { stopReason: "cancelled" });
    return;
  }
  respond(id, { stopReason: "end_turn" });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function handleRequest(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize": {
      respond(id, {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            image: true,
            audio: false,
            embeddedContext: true,
          },
          mcpCapabilities: {
            http: true,
            sse: true,
          },
          sessionCapabilities: {},
        },
        agentInfo: {
          name: "pipper-mock",
          title: "Pipper Mock Agent",
          version: "1.0.0",
        },
        authMethods: [],
      });
      break;
    }
    case "session/new": {
      const sessionId = randomUUID();
      const configOptions = structuredClone(defaultConfigOptions);
      sessions.set(sessionId, {
        id: sessionId,
        cwd: params?.cwd ?? process.cwd(),
        title: null,
        configOptions,
        cancelled: false,
      });
      // Advertise slash commands
      setTimeout(() => {
        sessionUpdate(sessionId, {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "help", description: "Show help", input: null },
            { name: "echo", description: "Echo text", input: { hint: "text" } },
          ],
        });
      }, 0);
      respond(id, { sessionId, configOptions });
      break;
    }
    case "session/load": {
      let session = sessions.get(params.sessionId);
      if (!session) {
        // Recreate from id for reconnect simulation
        session = {
          id: params.sessionId,
          cwd: params?.cwd ?? process.cwd(),
          title: "Restored session",
          configOptions: structuredClone(defaultConfigOptions),
          cancelled: false,
        };
        sessions.set(params.sessionId, session);
      }
      const benchmarkFixture = process.env.PIPPER_BENCHMARK_FIXTURE;
      if (benchmarkFixture) {
        void replayBenchmarkFixture(session.id, benchmarkFixture)
          .then(() => {
            respond(id, {
              sessionId: session.id,
              configOptions: session.configOptions,
            });
          })
          .catch((error) => {
            respondError(
              id,
              -32002,
              `Benchmark fixture replay failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        break;
      }
      respond(id, {
        sessionId: session.id,
        configOptions: session.configOptions,
      });
      // Replay a minimal history chunk
      setTimeout(() => {
        sessionUpdate(session.id, {
          sessionUpdate: "user_message_chunk",
          messageId: "history-user",
          content: { type: "text", text: "(session restored)" },
        });
        sessionUpdate(session.id, {
          sessionUpdate: "agent_message_chunk",
          messageId: "history-assistant",
          content: { type: "text", text: "Session loaded." },
        });
        sessionUpdate(session.id, {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "help", description: "Show help" },
            { name: "echo", description: "Echo text", input: { hint: "text" } },
          ],
        });
      }, 0);
      break;
    }
    case "session/resume": {
      const prev = params.prevSessionId ?? params.sessionId;
      const newId = randomUUID();
      const prevSession = sessions.get(prev);
      sessions.delete(prev);
      const session = {
        id: newId,
        cwd: prevSession?.cwd ?? params?.cwd ?? process.cwd(),
        title: prevSession?.title ?? null,
        configOptions: prevSession?.configOptions ?? structuredClone(defaultConfigOptions),
        cancelled: false,
      };
      sessions.set(newId, session);
      respond(id, {
        sessionId: newId,
        configOptions: session.configOptions,
      });
      break;
    }
    case "session/close": {
      respond(id, {});
      break;
    }
    case "session/delete": {
      sessions.delete(params.sessionId);
      respond(id, {});
      break;
    }
    case "session/set_config_option": {
      const session = sessions.get(params.sessionId);
      if (!session) {
        respondError(id, -32001, "Session not found");
        break;
      }
      session.configOptions = session.configOptions.map((opt) => {
        if (opt.id !== params.configId) return opt;
        if (opt.type === "select") {
          return { ...opt, currentValue: params.value };
        }
        if (opt.type === "boolean") {
          return { ...opt, currentValue: params.value === true || params.value === "true" };
        }
        return opt;
      });
      respond(id, { configOptions: session.configOptions });
      sessionUpdate(params.sessionId, {
        sessionUpdate: "config_option_update",
        configOptions: session.configOptions,
      });
      break;
    }
    case "session/prompt": {
      void handlePrompt(id, params);
      break;
    }
    case "authenticate": {
      respond(id, {});
      break;
    }
    case "_pipper/replace_prompt": {
      // Treat as a normal prompt for mock
      void handlePrompt(id, {
        sessionId: params.sessionId,
        prompt: [{ type: "text", text: params.text ?? "" }],
      });
      break;
    }
    default: {
      if (method?.startsWith("_")) {
        respond(id, {});
      } else {
        respondError(id, -32601, `Method not found: ${method}`);
      }
    }
  }
}

function handleNotification(msg) {
  const { method, params } = msg;
  if (method === "session/cancel") {
    const session = sessions.get(params?.sessionId);
    if (session) session.cancelled = true;
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (msg.id !== undefined && msg.method) {
    handleRequest(msg);
  } else if (msg.method) {
    handleNotification(msg);
  }
});

process.stdin.on("end", () => process.exit(0));
