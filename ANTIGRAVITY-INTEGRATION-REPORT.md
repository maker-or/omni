# Google Antigravity ACP integration

Updated 24 September 2026. After testing an installed-CLI bridge, the user chose Google's official ACP server. The CLI's headless mode soft-denied tool actions that needed approval. The official server speaks ACP directly, allowing Pipper to display and answer permission requests. [Google's Zed setup](https://antigravity.google/docs/ide/extensions/zed/), [ACP registry entry](https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json), [CLI headless permissions](https://antigravity.google/docs/cli/headless/).

## Implementation

- Pipper fetches the pinned Google ACP server version 1.2.1 on first use into a versioned user cache. The application bundle does not contain the Google server. macOS ARM64 and Windows x64 correspond to Pipper's current packaged targets; each archive has a release-pinned SHA-256 and exact expected file list. Installation uses a temporary directory, checksum verification, and atomic promotion. Concurrent callers share the install, with a cross-process lock. The macOS archive is 107 MiB compressed and includes the server and its `localharness_external` sibling.
- The existing ACP connection lifecycle, session routing, transcript rendering, MCP attachment, and client tool handlers now talk directly to Google's server. The first-party CLI bridge and npm adapter launch are removed. Permission requests enter Pipper's existing approval UI. An unanswered approval now cancels after two minutes instead of auto-allowing.
- Pipper offers the server's advertised Google OAuth, enterprise OAuth, Gemini API-key, and agent-platform authentication methods in setup. The CLI's cached credentials did not authenticate the ACP server in the local handshake, so users must complete ACP sign-in. The agent decides how each method obtains credentials; Pipper does not read credential files.
- Antigravity restoration errors preserve the thread's existing Pipper snapshot and session ID rather than silently starting a replacement. Prior CLI-bridge session IDs are explicitly identified as incompatible with the official server. A new Antigravity thread is required to continue those conversations.
- The app and public agent setup copy now describe the official server rather than the installed CLI.

## Verification and limits

The real macOS ARM64 server archive was downloaded and its SHA-256 recorded. A local install exercised checksum verification, extraction of both required files, atomic cache promotion, and a repeated cache hit. The verified files were moved to this machine's Pipper cache. The official executable negotiated ACP protocol version 1, advertised load/resume and four auth methods, and returned `auth_required` for `session/new` before ACP sign-in. Pipper's actual handshake probe classified this as `needs-auth` and returned those methods.

The earlier authenticated text-prompt test applied to the CLI bridge and does not prove an authenticated official-server prompt. A user must complete ACP sign-in to validate live prompts and interactive tool approvals. Windows installation and permission behavior require a Windows runtime check. Existing npm-adapter and CLI-bridge sessions remain displayable in Pipper but are not imported into Google's server.

Repository checks after the switch: app build, Electron TypeScript check, lint, React Doctor (100/100), and the full 443-test suite passed. The marketing site build was unavailable in this worktree because its separate `astro` dependency is not installed.
