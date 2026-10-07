# PipperRemote (Expo / React Native)

Cross-platform (iOS + Android) port of the native SwiftUI remote in
`native/pipper-remote-ios`. It talks to the laptop's `RemoteServer`
(`electron/remote-server.ts`) through the laptop's Pipper tunnel
(`https://lt-….pipper.dev`, see `docs/remote-access.md`) with the same API,
device pairing, owner verification, and per-phone tokens as the iOS app and
the hosted phone app.

Created with `npx create-expo-app@latest` (Expo SDK 57, Expo Router).

## What matches the iOS app

| iOS (`native/pipper-remote-ios`)                                                 | Expo (this app)                                                        |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `PairingLink` (QR / link / manual address + code)                                | `src/remote/pairing-link.ts`, same accept/refuse rules and tests       |
| `LaptopAttestation` (CryptoKit Ed25519)                                          | `src/remote/attestation.ts` (`@noble/curves`; Hermes has no WebCrypto) |
| `RemoteClient` + `RemoteClientError` messages                                    | `src/remote/client.ts`                                                 |
| `RemoteSubmissionStore` (retry-safe `requestId`)                                 | `src/remote/submissions.ts` (SHA-256 keys via `expo-crypto`)           |
| `RemoteSession` (token in Keychain, catalog cache)                               | `src/remote/session.ts` (`expo-secure-store`, AsyncStorage)            |
| Pairing → confirm laptop + verified owner → pair                                 | `app/pair.tsx`, `app/scan.tsx`, `app/confirm-pairing.tsx`              |
| Threads home: project picker + staggered card grid (5s poll)                     | `app/(tabs)/index.tsx`                                                 |
| Thread: Markdown transcript, decisions, stop, follow-ups, model switch (3s poll) | `app/thread/[id].tsx`                                                  |
| New thread (project / agent / model / task)                                      | `app/(tabs)/new`, shared with the sample task                          |
| Settings: Mac, connection checks, catalog, unpair                                | `app/(tabs)/settings`                                                  |

Wire types come straight from `contracts/remote.ts` (type-only import, so
Metro bundles nothing from outside this folder).

**Not ported:** Siri / App Intents / App Shortcuts. Those need a native iOS
target; the SwiftUI app remains the Siri-first client.

## Run

```bash
npm install
npx expo run:ios       # development build in the iOS Simulator
npx expo run:android   # development build on an Android emulator/device
```

Everything it uses ships in Expo Go too, so `npx expo start` and scanning the
QR with Expo Go works for quick UI iteration. Use a development build to test
the real app config (camera permission text, ATS / cleartext rules, URL
scheme).

Pair the way the iOS app does: Pipper on the Mac → Settings → Remote → Pair
a phone, then **Scan pairing QR**. In a simulator (no camera), paste the
pairing link, or type the `lt-….pipper.dev` address and the code.

Deep link: `pipper-remote://pair?url=<encoded pairing link>`. It always opens
the confirmation screen; nothing pairs silently. The iOS app registers the
same scheme, so install only one of them on a device.

## Transport rules

HTTPS only to `lt-*.pipper.dev` (named tunnel) and `*.trycloudflare.com`
(quick tunnel). Plain HTTP is allowed only to Tailscale (100.64/10) and
loopback addresses, where the laptop binds it. `app.json` therefore enables
`NSAllowsArbitraryLoads` (iOS) and `usesCleartextTraffic` (Android); the
pairing-link rules are what restrict plain HTTP.

## Checks

```bash
npx tsc --noEmit        # typecheck (includes contracts/remote.ts)
npx expo lint
npx expo-doctor
```

The protocol logic in `src/remote/*.test.ts` runs with the repo's root
`bun run test` (vitest). Formatting follows the repo's `bun run fmt` (oxfmt).
