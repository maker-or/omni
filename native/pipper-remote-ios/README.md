# PipperRemote (iOS, Siri-first)

Native SwiftUI companion that talks to the laptop's `RemoteServer`
(`electron/remote-server.ts`) through the laptop's Pipper tunnel
(`https://lt-….pipper.dev`, see `docs/remote-access.md`) — the same API,
device pairing, and per-phone tokens as the hosted phone app. Its reason to
exist is Siri:

> "Start a Pipper thread in FolkLore" → Siri asks "What should the thread
> work on?" → the laptop creates a `phone-xxxx` worktree + thread and runs the
> agent. The app never has to open.

## How it maps to the macOS Siri integration

| macOS (`native/pipper-intents`)                                     | iOS (this app)                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Electron writes `siri-catalog.json` to `~/Library/pipper`           | Laptop serves it as `GET /api/remote/catalog`; app caches it in its own Application Support                         |
| `String` params + `DynamicOptionsProvider` (ad-hoc workaround)      | Real `AppEntity` (`ProjectEntity`, `AgentEntity`) + `EntityStringQuery` so Siri phrases can carry the project/agent |
| Intent stages `siri-requests/<id>.json`, opens `pipper://siri/<id>` | Intent POSTs `/api/remote/threads` directly (`modelId` = agent id)                                                  |
| App Intents **extension** (needs sandbox exceptions)                | Intents run **in the app process** — no App Group, so a personal (free) team is enough                              |

The catalog shape is identical on both sides (`RemoteCatalog` ⇔ `SiriCatalog`
in `electron/siri/siri-catalog.ts`): selected agents only, with `available`.
Siri resolves names against the on-disk cache (fast, works with the Mac
asleep); the app refreshes it on launch/foreground, after every intent, and on
demand from Settings, then calls `updateAppShortcutParameters()` so Siri
learns new project names.

## Layout

- `Sources/PipperRemoteCore/` — Foundation-only: wire models, `RemoteConfig`
  (the paired laptop + this phone's token), `PairingLink` (parses the
  laptop's pairing QR/link), `LaptopAttestation` (checks pipper.dev's signed
  owner statement), `CatalogStore`, `RemoteClient`. `swift test` runs here on
  the Mac.
- `App/` — SwiftUI app, `RemoteSession` (pairing in Keychain + defaults,
  catalog), and `Intents/` (`StartThreadIntent`, `CheckMacIntent`, entities,
  `PipperRemoteShortcuts` phrases).
- `PipperRemote.xcodeproj` — single app target compiling both directories.

## Build & install

### Device (Siri by voice)

1. Open `PipperRemote.xcodeproj` in Xcode, select the `PipperRemote` target →
   Signing & Capabilities → pick your personal team. Change the bundle id if
   `com.maker-or.omni.remote` is taken on your team.
2. Run on the phone. Free provisioning profiles expire after 7 days — re-run
   from Xcode to renew.
3. On the Mac, choose the Cloudflare connection in Pipper → Settings → Remote
   (sign in to pipper.dev once so the laptop gets its `lt-…` address).
4. Pair: Settings → Remote → Pair a phone, then in the app tap **Scan pairing
   QR**. The app shows the laptop's name and verified owner; confirm to pair.
5. Say "Start a Pipper thread in <project>". First-time phrase indexing can
   take a minute after install.

### Simulator (intent via the Shortcuts app; no Siri voice)

```bash
native/pipper-remote-ios/scripts/run-simulator.sh            # iPhone 17 Pro
native/pipper-remote-ios/scripts/run-simulator.sh "iPhone 17"
```

Then pair manually (the simulator has no camera): copy the pairing link from
the Mac's Settings → Remote and paste it into **Pairing link or laptop
address**, or type the `lt-….pipper.dev` address and the code. Test the intent from
**Shortcuts → + → "Start Pipper thread"**.

**Why the project re-signs simulator builds.** Xcode ad-hoc signs every
simulator build, and an ad-hoc bundle has no Team ID. App Intents then cannot
register the app's `AppEntity` types (`ProjectEntity is not a registered
AppEntity identifier` in the log), every entity parameter arrives `nil`, and
Shortcuts reports "could not run because an internal error occurred"
(`LNContextErrorDomain 2004`). This is the same failure the ad-hoc macOS
extension hit. The target sets `CODE_SIGNING_ALLOWED=NO` for the simulator
SDK and `scripts/sign-simulator.sh` signs with the first `Apple Development`
identity in the keychain instead, so both `xcodebuild` and Xcode's Run button
produce a working build. You need to be signed in to Xcode → Settings →
Accounts once so that identity exists. Never pass `CODE_SIGNING_ALLOWED=NO`
on the command line: it also disables the re-sign phase.

Core tests (no simulator needed): `cd native/pipper-remote-ios && xcrun swift test`
(`xcrun` picks Xcode's toolchain, which has CryptoKit; a standalone
swift.org toolchain does not).

## Phrases

App Shortcuts allow one entity parameter per phrase, so:

- `Start a thread in Pipper` / `Start a Pipper thread` / `New Pipper thread`
- `Start a Pipper thread in <project>` / `New Pipper thread in <project>`
- `Start a Pipper thread with <agent>` / `Ask <agent> in Pipper`
- `Is my Mac reachable in Pipper` / `Check my Mac with Pipper`

Siri always asks for the task (it is a required `String`). When no agent is
named, `perform()` uses the Mac's default agent from the catalog, falling back
to the first available one.

## Pairing and threat model

Pairing follows the hosted phone app (`docs/remote-access.md`):

1. The Mac shows a one-time code as a QR/link:
   `https://remote.pipper.dev/#pair=CODE&host=lt-….pipper.dev`.
   The app only ever talks to `host`, and only when it is an `lt-*` host
   under pipper.dev (the zone locks those down as API-only). Laptop-served
   links (`<origin>/remote#pair=CODE`) work for quick tunnels
   (`*.trycloudflare.com`) and, over plain HTTP, Tailscale/loopback only.
2. Nothing is redeemed on the link's say-so. The app asks the laptop to
   describe itself (`POST /api/remote/pair/preview`, which doesn't use the
   code up), verifies pipper.dev's Ed25519 owner statement for that exact
   host with the built-in public key (`LaptopAttestation.pipperPublicKey`,
   same as `vite.remote-web.config.ts`; rotate both together), and shows
   "Belongs to … — verified by Pipper" or an **Unverified** warning.
3. On confirm, `POST /api/remote/pair` returns this phone's own token. It
   lives in the Keychain (`AfterFirstUnlock`, so Siri works from the lock
   screen); the laptop address and owner live in defaults.
4. Unpair revokes the token on the Mac (`DELETE /api/remote/session`). If
   the Mac revokes the phone instead, the next request gets a 401 and the
   app returns to pairing with a notice.

Builds before device pairing stored one shared Tailscale token; the Mac no
longer accepts it, so the app deletes it on launch and asks to pair again.

## Remote controls and recovery

Thread creation and follow-ups carry a `requestId` (the Mac still accepts
older phones without one, just without retry de-duplication). The phone retains an unacknowledged ID across retries and
app restarts; Pipper records it before creating a worktree or dispatching a
prompt. Follow-ups are acknowledged immediately. If Pipper restarts during an
uncertain dispatch, the existing request is shown as interrupted and is never
replayed automatically. Inspect its thread before deliberately starting new work.
A confirmed rejection before dispatch permits a new attempt after fixing setup.

New remote and Mac Siri threads require a verified Git worktree. A worktree
failure stops creation; follow-ups also stop if their worktree has disappeared.
Existing project-root threads can be read and stopped remotely, but further work
must be started in an isolated thread.

The thread report includes pending agent decisions. Choose the agent's offered
option, dismiss the request, or stop that thread; stale answers are rejected.
Unanswered permissions expire without approval. Stopping a thread also stops
its agent terminals and child runs without stopping another thread's terminals.

Connection checks on the home screen and in Settings verify pairing,
Pipper availability, installed agents, and projects. The sample-task form lets
you choose a project before asking its agent for a one-sentence description.
Thread views retain the last report during disconnects and show its update time.

Server receipts live under `userData/remote-requests/`. Do not delete this
history to retry a task: it prevents duplicate dispatch after a lost response.
ACP itself does not provide an idempotency key, so an interrupted execution
requires inspection instead of an automatic retry.
