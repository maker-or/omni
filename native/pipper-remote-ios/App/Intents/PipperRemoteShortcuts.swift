import AppIntents

/// Phrases Siri listens for without any Shortcuts setup. `\(.applicationName)`
/// is required in every phrase, and App Shortcuts allows at most one entity
/// parameter per phrase, so project and agent get separate phrase families.
/// Siri then asks for the (required) task; an unnamed agent resolves to the
/// Mac's default in `perform()`.
struct PipperRemoteShortcuts: AppShortcutsProvider {
  static var shortcutTileColor: ShortcutTileColor = .navy

  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartThreadIntent(),
      phrases: [
        "Start a thread in \(.applicationName)",
        "Start a \(.applicationName) thread",
        "New \(.applicationName) thread",
        "Start a \(.applicationName) thread in \(\.$project)",
        "Start a thread in \(\.$project) with \(.applicationName)",
        "New \(.applicationName) thread in \(\.$project)",
        "Start a \(.applicationName) thread with \(\.$agent)",
        "Ask \(\.$agent) in \(.applicationName)",
      ],
      shortTitle: "Start thread",
      systemImageName: "bubble.left.and.text.bubble.right"
    )
    AppShortcut(
      intent: CheckMacIntent(),
      phrases: [
        "Is my Mac reachable in \(.applicationName)",
        "Check my Mac with \(.applicationName)",
      ],
      shortTitle: "Check Mac",
      systemImageName: "laptopcomputer.and.arrow.down"
    )
  }
}
