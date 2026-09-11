# PipperIntents (Siri / Shortcuts)

Swift Package providing the Siri / Shortcuts / Spotlight entry point for
Pipper: `StartThreadIntent` with Project / Agent pickers backed by the shared
catalog `siri-catalog.json` (written by Electron, see
`electron/siri/siri-catalog.ts`).

Flow: the intent stages a request in `siri-requests/<uuid>.json` under both
`~/Library/pipper/` and `~/Library/Application Support/Pipper/`, then opens
`pipper://siri/<uuid>`. Electron consumes the pending request during startup,
activation, or the deep link; creates the thread; hands off the prompt; and
lands on it. macOS runs App Intents extensions in the App Sandbox, and ad-hoc
builds have no Team ID for App Groups, so the extension reaches those two
directories via `temporary-exception.files.home-relative-path` entitlements.

## Packaging

`swift build` here only validates compilation. The packaged macOS app is built
with the `PipperIntents` Xcode extension target, which emits
`Metadata.appintents`; `scripts/build.js` builds it automatically before
`electron-builder` embeds it in the app.

## App Shortcuts Preview host

The minimal `PreviewApp/PipperIntentsPreview.xcodeproj` host reuses
`Sources/PipperIntents.swift` directly and exists only to generate an app
bundle for inspecting the App Intents metadata. Open the project with Xcode 27
beta, select the `PipperIntentsPreview` scheme, and build it once. The preview
extension uses a unique bundle identifier and supplies one Demo Project and
Preview Agent when no Electron catalog is present.

Important: Apple does not support App Shortcuts or flexible phrase matching on
macOS. The Mac target will therefore show `No Flexible Matching Assets` in
Product > App Shortcuts Preview. The generated metadata still verifies that
the intent and its exact registered phrases are present. On macOS, the intent
is available as an action in the Shortcuts app instead.

The registered phrases are:

- `Start a thread in Pipper`
- `New thread in Pipper`
- `Start a thread with Pipper`

The App Intents extension target in this project is embedded into the packaged
Electron app by `electron-builder.yml`. The preview app target remains useful
for inspecting metadata independently.
