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
    // Thread titles are long agent-written summaries that don't work as
    // spoken parameters, so these phrases target the most recent thread;
    // pick another in Shortcuts or when Siri asks.
    AppShortcut(
      intent: GetThreadStatusIntent(),
      phrases: [
        "How's my \(.applicationName) thread",
        "What's \(.applicationName) doing",
        "Check my \(.applicationName) thread",
        "Get the status of my \(.applicationName) thread",
      ],
      shortTitle: "Thread status",
      systemImageName: "text.bubble"
    )
    AppShortcut(
      intent: SendFollowUpIntent(),
      phrases: [
        "Follow up in \(.applicationName)",
        "Send a follow-up in \(.applicationName)",
        "Reply to my \(.applicationName) thread",
      ],
      shortTitle: "Send follow-up",
      systemImageName: "arrowshape.turn.up.right"
    )
    // GitHub actions run on pipper.dev; repo names come from the cached list
    // refreshed by PipperAccount.
    AppShortcut(
      intent: FileGitHubIssueIntent(),
      phrases: [
        "File a GitHub issue with \(.applicationName)",
        "File an issue in \(.applicationName)",
        "File an issue in \(\.$repository) with \(.applicationName)",
        "Create a \(.applicationName) issue in \(\.$repository)",
      ],
      shortTitle: "File issue",
      systemImageName: "exclamationmark.bubble"
    )
    AppShortcut(
      intent: SummarizeMyPullRequestsIntent(),
      phrases: [
        "Summarize my pull requests in \(.applicationName)",
        "Summarize my open PRs in \(.applicationName)",
        "What are my open pull requests in \(.applicationName)",
      ],
      shortTitle: "My pull requests",
      systemImageName: "arrow.triangle.pull"
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
