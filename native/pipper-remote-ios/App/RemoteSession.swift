import AppIntents
import Foundation
import Observation

/// Process-wide state shared by the SwiftUI app and the in-process App
/// Intents: pairing config, the cached catalog, and a client built from them.
@MainActor
@Observable
final class RemoteSession {
  static let shared = RemoteSession()

  private enum Keys {
    static let host = "remote.host"
    static let port = "remote.port"
    static let token = "remote.token"
    static let lastSiriThreadId = "remote.lastSiriThreadId"
  }

  private(set) var config: RemoteConfig?
  private(set) var catalog: RemoteCatalog
  private(set) var catalogError: String?
  private(set) var lastCatalogRefresh: Date?

  let catalogStore = CatalogStore.standard()
  private let submissions = RemoteSubmissionStore()
  #if DEBUG
  private var isPreview = false
  #endif

  func createThread(projectId: String, agentId: String?, prompt: String) async throws -> RemoteThreadSummary {
    guard let client, let config else { throw RemoteClientError.notPaired }
    let scope = [config.host, String(config.port), "create", projectId, agentId ?? "", prompt]
    let id = try submissions.requestId(for: scope)
    do {
      let thread = try await client.createThread(projectId: projectId, agentId: agentId, prompt: prompt, requestId: id)
      try submissions.acknowledge(scope, requestId: id)
      return thread
    } catch RemoteClientError.rejected(let message) {
      // The Mac confirmed it never dispatched this request. A deliberate
      // retry after fixing setup may use a new ID; timeouts retain the old ID.
      try submissions.acknowledge(scope, requestId: id)
      throw RemoteClientError.rejected(message)
    }
  }

  func sendPrompt(threadId: String, prompt: String) async throws {
    guard let client, let config else { throw RemoteClientError.notPaired }
    let scope = [config.host, String(config.port), "prompt", threadId, prompt]
    let id = try submissions.requestId(for: scope)
    do {
      try await client.sendPrompt(threadId: threadId, prompt: prompt, requestId: id)
      try submissions.acknowledge(scope, requestId: id)
    } catch RemoteClientError.rejected(let message) {
      try submissions.acknowledge(scope, requestId: id)
      throw RemoteClientError.rejected(message)
    }
  }

  private init() {
    let defaults = UserDefaults.standard
    lastSiriThreadId = defaults.string(forKey: Keys.lastSiriThreadId)
    if let host = defaults.string(forKey: Keys.host), !host.isEmpty,
      let token = Keychain.read(Keys.token), !token.isEmpty
    {
      let port = defaults.integer(forKey: Keys.port)
      config = RemoteConfig(host: host, port: port == 0 ? RemoteConfig.defaultPort : port, token: token)
    }
    catalog = catalogStore.load() ?? .empty
    lastCatalogRefresh = catalogStore.modifiedAt
  }

  #if DEBUG
  /// Preview-only initializer: seeds a catalog without touching the Keychain,
  /// UserDefaults, or the shared on-disk cache. The paired state uses a dummy
  /// config, while `client` remains nil so previews never make network requests.
  init(previewCatalog: RemoteCatalog, paired: Bool = false) {
    config = paired ? RemoteConfig(host: "preview.invalid", port: RemoteConfig.defaultPort, token: "preview") : nil
    catalog = previewCatalog
    catalogError = nil
    lastCatalogRefresh = nil
    lastSiriThreadId = nil
    isPreview = true
  }

  /// A detached session for SwiftUI previews.
  static func preview(catalog: RemoteCatalog = .empty, paired: Bool = false) -> RemoteSession {
    RemoteSession(previewCatalog: catalog, paired: paired)
  }
  #endif

  var isPaired: Bool { config?.isComplete == true }

  var client: RemoteClient? {
    #if DEBUG
    if isPreview { return nil }
    #endif
    guard let config, config.isComplete else { return nil }
    return RemoteClient(config: config)
  }

  /// Persist a pairing after `health()` succeeded. Token goes to the Keychain,
  /// host/port to defaults.
  func pair(_ next: RemoteConfig) throws {
    try Keychain.write(Keys.token, value: next.token)
    let defaults = UserDefaults.standard
    defaults.set(next.host, forKey: Keys.host)
    defaults.set(next.port, forKey: Keys.port)
    config = next
  }

  func unpair() {
    let defaults = UserDefaults.standard
    defaults.removeObject(forKey: Keys.host)
    defaults.removeObject(forKey: Keys.port)
    lastSiriThreadId = nil
    Keychain.delete(Keys.token)
    catalogStore.clear()
    config = nil
    catalog = .empty
    lastCatalogRefresh = nil
    Task { PipperRemoteShortcuts.updateAppShortcutParameters() }
  }

  /// Pull the laptop catalog, cache it for Siri, and tell App Shortcuts the
  /// entity names changed so spoken phrases like "in FolkLore" resolve.
  @discardableResult
  func refreshCatalog() async -> RemoteCatalog? {
    guard let client else { return nil }
    do {
      let fresh = try await client.fetchCatalog()
      try? catalogStore.save(fresh)
      catalog = fresh
      catalogError = nil
      lastCatalogRefresh = Date()
      PipperRemoteShortcuts.updateAppShortcutParameters()
      return fresh
    } catch {
      catalogError = error.localizedDescription
      return nil
    }
  }

  /// Refresh only when the cache is missing or older than `maxAge`.
  func refreshCatalogIfStale(maxAge: TimeInterval = 10 * 60) async {
    if let last = lastCatalogRefresh, Date().timeIntervalSince(last) < maxAge, !catalog.projects.isEmpty {
      return
    }
    await refreshCatalog()
  }

  // MARK: Siri → app handoff

  /// Thread most recently created by Siri; the app lands on it next open.
  var lastSiriThreadId: String? {
    didSet { UserDefaults.standard.set(lastSiriThreadId, forKey: Keys.lastSiriThreadId) }
  }
}

#if DEBUG
/// Sample data for SwiftUI previews. DEBUG-only and never persisted.
enum PreviewData {
  static let catalog = RemoteCatalog(
    updatedAt: "2026-09-27T00:00:00Z",
    defaultAgentId: "codex",
    projects: [
      RemoteCatalogProject(id: "folklore", name: "FolkLore", path: "~/code/folklore"),
      RemoteCatalogProject(id: "omni", name: "Omni", path: "~/code/omni"),
    ],
    agents: [
      RemoteCatalogAgent(id: "codex", displayName: "Codex", available: true),
      RemoteCatalogAgent(id: "claude", displayName: "Claude Code", available: true),
      RemoteCatalogAgent(id: "cursor", displayName: "Cursor", available: false),
    ])

  static let threads: [RemoteThreadSummary] = [
    RemoteThreadSummary(
      id: "a1b2c3d4-0000-0000-0000-000000000001", projectId: "folklore",
      worktreePath: "~/code/folklore/.worktrees/a1b2c3d4", title: "Add dark mode toggle",
      running: true, lastUsedAt: 0),
    RemoteThreadSummary(
      id: "e5f6a7b8-0000-0000-0000-000000000002", projectId: "omni",
      worktreePath: nil, title: "Summarize the launch plan", running: false, lastUsedAt: 0),
    RemoteThreadSummary(
      id: "c9d0e1f2-0000-0000-0000-000000000003", projectId: "folklore",
      worktreePath: "~/code/folklore/.worktrees/c9d0e1f2", title: nil, running: false,
      lastUsedAt: 0),
  ]

  static let report = RemoteReport(
    threadId: threads[0].id,
    running: true,
    summary: "Add dark mode toggle",
    finalText: nil,
    messages: [
      RemoteMessage(role: .user, text: "Add a dark mode toggle to Settings and remember the choice."),
      RemoteMessage(
        role: .agent,
        text:
          "Done. I added a **Dark mode** toggle to `SettingsView`, bound to `@AppStorage(\"darkMode\")`.\n\n- Toggle in Settings\n- Applies `preferredColorScheme` at the root"
      ),
      RemoteMessage(role: .user, text: "Nice — does it survive relaunch?"),
      RemoteMessage(role: .agent, text: "Yes, `@AppStorage` persists it across launches."),
    ],
    projectName: "FolkLore",
    filesTouched: ["App/Views/SettingsView.swift", "App/PipperRemoteApp.swift"],
    worktreePath: "~/code/folklore/.worktrees/a1b2c3d4",
    isolated: true,
    isolationNote: nil,
    permissions: nil,
    request: nil)

  static let reportNeedsInput = RemoteReport(
    threadId: threads[2].id,
    running: false,
    summary: "Refactor the settings screen",
    finalText: nil,
    messages: [
      RemoteMessage(role: .user, text: "Refactor SettingsView and delete the old file."),
      RemoteMessage(role: .agent, text: "I can delete `OldSettingsView.swift`. Confirm before I proceed."),
    ],
    projectName: "FolkLore",
    filesTouched: ["App/Views/SettingsView.swift"],
    worktreePath: "~/code/folklore/.worktrees/c9d0e1f2",
    isolated: false,
    isolationNote: "No Git worktree was available.",
    permissions: [
      RemotePermission(
        id: "perm-1",
        title: "Delete file?",
        detail: "rm App/Views/OldSettingsView.swift",
        options: [
          RemotePermission.Option(optionId: "allow", name: "Allow", kind: "allow"),
          RemotePermission.Option(optionId: "deny", name: "Deny", kind: "deny"),
        ])
    ],
    request: nil)
}
#endif
