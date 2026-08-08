---
title: "MCP vs ACP: The Two Protocols Powering AI Coding Agents"
description: "MCP vs ACP: MCP connects AI agents to tools and data; ACP connects editors and interfaces to agents. See how they fit together. Download Pipper Code free."
date: 2026-08-08
author: "The Pipper Team"
category: "AI Development Tools"
tags:
  - MCP vs ACP
  - Model Context Protocol
  - Agent Client Protocol
  - AI coding agents
  - multi-agent workflows
  - developer tools
  - Pipper
keywords:
  - mcp vs acp
  - mcp vs acp explained
  - model context protocol vs agent client protocol
  - acp and mcp difference
  - what is mcp
  - what is acp
slug: mcp-vs-acp-explained
---

# MCP vs ACP: The Two Protocols Powering AI Coding Agents

Every week, the same question surfaces in developer forums: **MCP vs ACP** — are these two protocols competing, and should you care? Here is the MCP vs ACP explained version: the Model Context Protocol (MCP) and the Agent Client Protocol (ACP) are not rivals. They solve two different problems in the same modern AI stack, and once you see the boundary, everything else clicks into place.

**TL;DR:** MCP is the agent-to-tool axis — how an AI agent connects to databases, APIs, file systems, and servers for the tools and context it needs to work. ACP is the client-to-agent axis — how an editor, IDE, or orchestration app drives a coding agent over JSON-RPC, including sessions, prompts, tool-call reporting, and permission requests. The two complement each other, and a single session routinely uses both at once.

## What Is MCP (Model Context Protocol)?

> **Definition — MCP:** The Model Context Protocol, created by Anthropic and released as an open standard, is how an AI agent connects to external tools, databases, file systems, and servers. MCP servers expose capabilities as tools, resources, and prompts; MCP clients (the agents) discover them and call them mid-conversation. It is the agent-to-tool axis of the stack.

MCP focuses on one thing: giving an agent a clean, unified way to reach the world outside its own weights. Instead of building one custom integration per database or per API, an agent implements an MCP client, and every MCP server plugs in behind a standard JSON-RPC interface. Connections are dispatched, tools are announced, and the agent calls them as it needs them.

Think of MCP as the standard that answers the question _"How does my agent get the tools?"_ A connect-the-dots integration story — a filesystem server, a Postgres server, a Slack server, a web search server — becomes one protocol with many implementations.

## What Is ACP (Agent Client Protocol)?

> **What is ACP?** The Agent Client Protocol, created by Zed and JetBrains and licensed Apache-2.0, is how a client — an editor, IDE, or orchestration app — communicates with a coding agent. Over JSON-RPC 2.0, it defines the lifecycle of agent work: `session/new`, `session/prompt`, streamed `session/update` notifications, and `session/request_permission` gates. It is the client-to-agent layer, the "LSP for agents" of the stack.

If MCP helps an agent do its job, ACP answers the question **"How do I drive the agent at all?"**. Before it, every agent shipped its own terminal and its own CLI, and building one interface that managed Claude Code, Codex, and Cursor meant N × M hand-rolled bridges. ACP collapses that grid: one protocol, any ACP-capable agent, from any ACP-capable client.

ACP is far more than a chat pipe. It models a full working turn — the session holds persistent context, prompts carry text and file attachments, tool calls arrive as lifecycle events with explicit permission requests, and a turn ends with a structured `stopReason`. That process model is how a human-in-the-loop review surface stays honest.

## MCP vs ACP vs LSP: One Stack, Three Compatible Layers

The same wave that produced MCP and ACP also brought LSP (Language Server Protocol) to mind, and the three keep getting conflated. Here is how the boundaries break:

| Dimension             | MCP                                              | ACP                                                           | LSP                                |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------- |
| **What it connects**  | Agent (client) to tools and data via MCP servers | Client/editor to coding agent                                 | Editor to language server          |
| **Created by**        | Anthropic                                        | Zed and JetBrains                                             | Microsoft                          |
| **Example message**   | `tools/call` for a filesystem or database tool   | `session/new`, `session/prompt`, `session/request_permission` | `textDocument/publishDiagnostics`  |
| **Role in the stack** | Gives the agent its toolbox and context          | Gives the interface its agent                                 | Gives the editor code intelligence |

None of the three compete. LSP puts intelligence in the editor. MCP puts tools in the agent. ACP puts the agent in the interface. Read them all as the same theme echoing: **standards beat bespoke integrations** — LSP just runs at a different layer (language intelligence) than MCP (tools) or ACP (agent control).

## How Everything Fits: Human, ACP, Agent, and MCP in One Stack

Here is the tiny stack that explains more than a thousand words:

```
Human → (ACP) → Coding Agent → (MCP) → Tools: database, APIs, filesystem, servers
```

Read it left to right and the division of labor appears. A human drives a coding agent over ACP — prompts in, plan and tool-call updates out, permission requests gated at the human's hand. The agent, in turn, drives MCP tools — the filesystem, the database, the build server — as the means to actually get the job done. The same session uses both protocols; they are just doing different jobs.

The ACP and MCP difference, stated plainly: **ACP is the steering wheel, MCP is the toolbox.** One tells the agent what to do and keeps the human in the loop; the other gives the agent the levers it needs to work. When you run a coding agent in one window and watch it read a live Postgres schema through an MCP server, you are seeing the boundary in action.

## Why Pipper Uses ACP: A Client With MCP-Capable Agents

Pipper Code is a free desktop app that runs and orchestrates many AI coding agents from one interface — Claude Code, Codex, Cursor, OpenCode, Copilot, and more. We chose the ACP side of that stack deliberately, because a neutral protocol is what makes bring-your-own-agents an honest claim.

Here is the hidden detail: on Pipper's side, **ACP and MCP coexist**. An ACP-capable client launches the agent; the agent, as an MCP client itself, connects to whatever tools you gave it — even an MCP server list passed in at session creation. One Pipper session can push a prompt over ACP while the agent reaches a filesystem server over MCP. The two protocols nest, rather than fight.

That puts Pipper on the boundary every developer cares about: the client-and-agent division. Because it speaks ACP, Pipper does not re-implement or own any agent; it just drives them all identically.

## Key Takeaways

- MCP (Anthropic, open) is the **agent-to-tool** protocol: it connects an agent to databases, APIs, file systems, and servers via tools and context.
- ACP (Zed/JetBrains, Apache-2.0) is the **client-to-agent** protocol: it drives a coding agent from a UI or editor over JSON-RPC with sessions, prompts, tool-call reports, and permission requests.
- They complement — a working stack will use ACP to drive an agent and MCP for the agent to reach its tools **in the same session**.
- LSP is the older analog; it standardizes editor-language integration just as ACP standardizes editor-agent integration and MCP standardizes the agent's toolbox.
- Pipper Code is an ACP client, so any ACP-capable agent plugs in — and the agents themselves remain MCP clients with your tools.

## FAQ

### Are MCP and ACP interchangeable?

No, and they cannot be. MCP and ACP solve different boundaries. MCP connects an agent to tools and data; ACP connects an interface or editor to the agent. Confusing the two is like mixing up the steering wheel and the toolbox on the same car.

### Can an agent use both MCP and ACP?

Yes — and in practice they do, all the time. A single session can be driven by a client through ACP while the same agent reaches a filesystem or database through MCP. Different directions, same session, no conflict.

### Who created the MCP and ACP protocol?

MCP was created by Anthropic and released as an open protocol for connecting agents to tools. ACP was created by the teams behind Zed and JetBrains and is licensed under Apache-2.0, built in the spirit of LSP for the agent layer.

### Why does Pipper use ACP and not just MCP?

Because Pipper's job is the interface — running and orchestrating many coding agents from one window. That is an ACP problem. The agents themselves already act as MCP clients, so Pipper leaves the tool layer to them; it standardizes the driving that ties them together.

### Which one should I learn or adopt?

If you are building integrations so an agent can reach your data, learn to build **MCP servers**. If you are building the interface that drives agents — a client, an orchestration layer, a desktop app — that is **ACP's** concern. Most developers touch MCP first, then ACP.

## Conclusion

The terms **MCP and ACP** keep getting conflated, but the stack is anything but a zero-sum battle. MCP hands agents their tools, ACP hands you the agents, and the two work together inside a single session. Understanding the model context protocol vs agent client protocol distinction is not hair-splitting — it is the difference between building an agent and building the interface that controls it.

Pipper Code sits on the ACP side of that boundary, so Claude Code and Codex run side by side from one window while each agent still reaches its own MCP tools. Try it yourself.

Download Pipper Code free at **[pipper.dev/download](/download)**, and explore more: read the [Agent Client Protocol in depth](/blog/blog14.md) or the guide to [Pipper and Multi-Agent Workflows](/blog/blog11.md).
