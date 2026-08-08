---
title: "Agent Client Protocol (ACP) Explained: The LSP for AI Coding Agents"
description: "Learn the Agent Client Protocol: how ACP standardizes editor-agent chat over JSON-RPC, and why ACP-based Pipper lets you bring any coding agent. Try it free."
date: 2026-08-08
author: "The Pipper Team"
category: "AI Development Tools"
tags:
  - Agent Client Protocol
  - ACP
  - AI coding agents
  - multi-agent workflows
  - developer tools
  - Pipper
keywords:
  - Agent Client Protocol
  - what is the agent client protocol
  - acp vs mcp
  - acp coding agents
slug: agent-client-protocol-explained
---

# Agent Client Protocol (ACP) Explained: The LSP for AI Coding Agents

Every AI coding agent ships with its own terminal, its own CLI, and its own opinion about how you talk to it. The **Agent Client Protocol (ACP)** fixes that. It is an open, Apache-2.0 specification that gives editors, IDEs, and orchestration apps one standardized way to drive any AI coding agent — which is exactly why a bring-your-own-agents tool like Pipper Code is built on top of it.

**TL;DR:** ACP is the missing standardization layer for AI coding agents. It defines how a client initializes a connection, creates a session, sends prompts, streams responses, and gates tool calls behind permission requests — all over plain JSON-RPC 2.0. If you want to control Claude Code, Codex, Cursor, OpenCode, Copilot, or Grok from a single interface, the honest way to build it is on ACP.

## What Is the Agent Client Protocol (ACP)?

> **What is ACP?** The Agent Client Protocol is an open standard for how a client — an editor, IDE, or orchestration app — communicates with a coding agent. It uses JSON-RPC 2.0 messages over stdio and defines the core operations of agent work: negotiating versions, creating sessions, prompting, streaming updates, and requesting permission for tool calls. ACP was created by Zed and JetBrains, is licensed under Apache-2.0, and its specification lives at agentclientprotocol.com.

ACP is really two things. As a _contract_, both sides agree on method names like `session/new` and `session/prompt`, on a JSON-RPC 2.0 envelope, and on what counts as a valid result, error, or notification. As a _process model_, it does not just shuffle text — it structures a full working turn: a user message in, tool calls in the middle, and a `stopReason` out, all bound to the same session.

That process model is what makes it more than a chat protocol. ACP knows about sessions with persistent context, prompts with file and image attachments, and tool calls that can demand explicit human permission. It is the grammar of agent work.

**ACP is to agents what LSP was to language servers.** The Language Server Protocol (LSP) standardized editor-language intelligence — build one adapter, and every editor reuses it. ACP standardizes how clients get coding-agent labor: one protocol, every ACP agent.

## The Problem ACP Solves: The Editor × Agent Matrix

Before ACP, a client that wanted to drive agents had two choices: hand-build an integration per agent, or scrape a shell history and call it a day. Neither scales.

Put editors on one axis — VS Code, Zed, JetBrains, or just your three-terminal setup. Put agents on the other — Claude Code, Codex, Cursor's agent mode, OpenCode, Copilot, Grok. Working with all of them means a bespoke bridge at every intersection: N × M custom integrations, each tracking the other side's CLI changes and quirks.

That cost is why agents stay locked to their own shells. The first bridge works. The second is a grind. Nobody ever ships the full grid.

ACP collapses the matrix. An agent that implements ACP is drivable by any ACP client; a client that implements ACP can drive any ACP agent. N × M custom bridges become one shared adapter per side, maintained once. That economy is why the ACP ecosystem grows the way LSP's did.

## How the Agent Client Protocol Works

ACP is client–server. The **client** is the editor, IDE, or orchestration app; the **agent** is the automation — Claude Code, Codex, whoever you already run. Messages are JSON-RPC 2.0 over stdio, in two shapes:

- **Methods** — request→response pairs that expect a `result` or an `error`.
- **Notifications** — one-way messages that expect nothing in reply.

A working session walks the same lifecycle every time:

### 1. Initialize

The client sends `initialize`; the agent replies with its protocol version and capabilities. One handshake decides which permission, session, and prompt features are on the table.

### 2. Create a Session

The client calls `session/new` with a working directory (plus optional MCP servers). The agent creates an isolated conversation and returns a unique ID; everything after targets that ID.

### 3. Send a Prompt

The client sends `session/prompt` with a user message and optional content blocks — text, files, images. The agent accepts and starts processing.

### 4. Stream Updates

The agent reports progress with `session/update` notifications: a plan, text chunks, tool call state changes.

### 5. Ask Permission

To run a tool, the agent sends `session/request_permission`; the client answers with `session/confirm_permission` — allow or deny. This is how a human stays in the loop.

### 6. Finish the Turn

The `session/prompt` resolves with a stop reason: `end_turn`, `max_tokens`, or `cancelled`. The conversation continues with a new prompt against the same session.

```
 Client (Pipper, an editor)                    Agent (Claude Code, Codex)
     | initialize (protocol version, caps)       |
     |------------------->---------------------->|
     |<------------------ result, capabilities --|
     |                                            |
     |  session/new (cwd, mcpServers)            |
     |------------------->---------------------->|
     |<------------------ sessionId -------------|
     |                                            |
     |  session/prompt (message + blocks)        |
     |------------------->---------------------->|
     |<-- session/update : plan ------------------|
     |<-- session/update : text chunk -----------|
     |<-- session/request_permission (tool) -----|
     |  session/confirm_permission (allow)       |
     |------------------->---------------------->|
     |<-- session/update : tool running ---------|
     |<-- session/update : tool done ------------|
     |<-- session/prompt result (stopReason) ----|
     │                                            │
```

Read top to bottom and ACP's shape appears: one handshake, one session, one prompt at a time, streamed progress, and explicit gates wherever the agent reaches for your machine.

## The Wire: `session/prompt` in JSON-RPC

The messages are plain JSON-RPC 2.0 — no exotic transport, and the barrier is low. Here a prompt starts a turn on the session we created:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/prompt",
  "params": {
    "sessionId": "sess_abc123def456",
    "prompt": [
      { "type": "text", "text": "Find the root cause of the flaky checkout test and refactor it." }
    ]
  }
}
```

The prompt is a list of content blocks, so the same call can attach a file as a resource or inline text with a URI — just push another block. Progress flows back as `session/update` notifications; text streams in chunks, and each tool call gets its own lifecycle update:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "messageId": "msg_6",
      "content": { "type": "text", "text": "I'll start by tracing the checkout handler..." }
    }
  }
}
```

The client renders that stream however it likes — chat pane, checklist, terminal. The protocol is portable; the presentation is free.

## ACP vs MCP vs LSP

These three JSON-RPC-heavy specs get confused because all three rode the same AI wave. They are companions at different layers:

| Dimension               | ACP                                     | LSP                                        | MCP                          |
| ----------------------- | --------------------------------------- | ------------------------------------------ | ---------------------------- |
| Owner                   | Zed and JetBrains (Apache-2.0)          | Microsoft                                  | Anthropic                    |
| Main job                | Standardize client ↔ agent integration  | Standardize editor ↔ language intelligence | Standardize app ↔ tools/data |
| Core entities           | Sessions, prompts, updates, permissions | Documents, diagnostics, completion         | Tools, resources, prompts    |
| Message style           | Multi-turn, streamed                    | Stateful documents, incremental edits      | Mostly stateless calls       |
| Producer of the payload | Coding agents (Claude Code, Codex)      | Language servers (pyright)                 | MCP servers (filesystem, DB) |
| Analogy                 | "LSP for agents"                        | Edit-time code understanding               | The agent's toolbox          |

The common confusion is ACP vs MCP. They nest: a client opens an agent via ACP, and that agent calls MCP tools. For the full breakdown, see [MCP vs ACP: How They Fit Together](/blog/blog20.md). For a product view of the same layer, open [What Is an AI Agent Interface?](/blog/blog1.md).

## Why an ACP-Based Client Matters: Bring Your Own Agents

Pipper Code is a free desktop app that runs and orchestrates many AI coding agents from one interface — Claude Code, Codex, Cursor, OpenCode, Copilot, Grok, and everything else that speaks the protocol. It is built on ACP, and that single choice is the product.

**Bring your own agents.** Because Pipper is an ACP client, it never prescribes which model you may run. If your agent speaks ACP, plug it in; if you already pay for Claude or Codex, keep your own budget. The orchestrator is not the subscription — your agents are.

**One surface for every agent.** When Pipper launches a Claude Code turn in one scene and a Codex turn in another, both stream through the same ACP lifecycle — same sessions, same permission prompts, same review window. The human gets a single gate for every vendor. For how that plays out as a workflow, see [Pipper and Multi-Agent Workflows](/blog/blog11.md).

**Multi-agent without multi-vendor lock-in.** ACP even carries an optional MCP server list inside `session/new` — the agent connects to _your_ tools. The modern stack therefore nests cleanly: ACP drives the agent, MCP arms it with tools, and you keep the credits and the choice.

## Key Takeaways

- The Agent Client Protocol (ACP) is an open, Apache-2.0 standard for the client–agent boundary, created by Zed and JetBrains.
- ACP runs on JSON-RPC 2.0 over stdio using methods (`initialize`, `session/new`, `session/prompt`) and notifications (`session/update`, `session/request_permission`).
- ACP turns the editor × agent matrix into one shared adapter per side, not N × M bridges.
- LSP gives editors language intelligence, MCP gives agents tools, and ACP gives interfaces the agent itself — three protocols that nest.
- Pipper Code is built on ACP so you can orchestrate Claude Code, Codex, Cursor, OpenCode, Copilot, or Grok from one window — free to download.

## FAQ

### Is ACP the same as MCP?

No, and they work together. ACP standardizes how a client _drives an agent_; MCP standardizes how an agent _reaches external tools and data_. An ACP session can even hand the agent a list of MCP servers at creation. ACP is the driver's seat; MCP is the toolbox behind the agent.

### Who created ACP?

Zed and JetBrains — the teams behind the Zed editor and the IntelliJ-platform family. It's Apache-2.0, so both clients and agents built on it stay free and open.

### Which agents support ACP?

Claude Code, Codex, Cursor, OpenCode, Copilot, Grok, and any other implementing agent. It's a spec, not a vendor feature, so the list grows — and because Pipper is an ACP client, whatever learns the protocol becomes driveable from the same window.

### Why does Pipper use ACP?

Because "one interface, many agents" is only honest when the protocol underneath is neutral. ACP lets Pipper orchestrate any compliant agent identically, stream progress and permission prompts into one review surface, and keep your own agents and billing. No lock-in, by construction.

### Do I need to read the spec to use a product built on it?

No. If you build a client or agent, the schemas at agentclientprotocol.com cover the wire contract. If you're a user, you never see it — you just see one window managing all your agents.

### What does "the LSP for AI coding agents" mean?

Just as LSP made language servers reusable across editors, ACP makes coding agents reusable across clients. It's the standardization that lets one interface drive agents from many vendors without reinventing each integration.

## Conclusion

ACP is to coding agents what LSP was to language servers: the neutral layer that replaces fragmentation with an ecosystem. An agent that speaks ACP can be driven by any ACP client; a client that speaks ACP can drive whatever agent brings. That is the bet Pipper Code is built on.

Try it: [Download Pipper Code free](/download), run Claude Code and Codex side by side in one window, keep your own credits, and watch permission prompts land in one place. Then read [Pipper vs Cursor](/blog/blog2.md) to see how an editor and an orchestrator fit together.

**Download Pipper Code free at [pipper.dev/download](https://pipper.dev/download).**
