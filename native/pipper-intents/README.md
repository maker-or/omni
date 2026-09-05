# PipperIntents (Siri / Shortcuts)

Swift Package providing the Siri entry point for Pipper: `StartThreadIntent`
plus `ProjectEntity` / `AgentEntity` backed by the shared catalog at
`~/Library/pipper/siri-catalog.json` (written by Electron, see
`electron/siri/siri-catalog.ts`).

Flow: intent stages `~/Library/pipper/siri-requests/<uuid>.json`, then opens
`pipper://siri/<uuid>`. Electron handles the deep link (`handlePipperDeepLink`
in `electron/main.ts`), creates the thread, delivers the prompt, and lands on
it. Confirm-then-create: nothing is created until the user confirms.

## Known limitation: bundle packaging

`swift build` here only validates compilation. For Siri/Shortcuts to discover
`PipperShortcuts`, these types must be compiled into the shipped `.app` bundle
via a real Xcode app/extension target (which emits `Metadata.appintents`).
That host target + `electron-builder` `extraFiles` wiring is a tracked
follow-up; until then the intent cannot be tested end-to-end in Siri.
