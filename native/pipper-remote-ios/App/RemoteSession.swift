import AppIntents
import Foundation
import Observation
import UIKit

/// Process-wide state shared by the SwiftUI app and the in-process App
/// Intents: pairing config, the cached catalog, and a client built from them.
@MainActor
@Observable
final class RemoteSession {
  static let shared = RemoteSession()

  private enum Keys {
    /// The paired laptop (address, name, owner) without its token.
    static let laptop = "remote.laptop"
    /// This phone's device token for that laptop.
    static let deviceToken = "remote.deviceToken"
    static let lastSiriThreadId = "remote.lastSiriThreadId"
    /// Before device pairing: one shared Tailscale token per laptop. The
    /// laptop no longer accepts it, so it is only ever cleaned up.
    static let legacyHost = "remote.host"
    static let legacyPort = "remote.port"
    static let legacyToken = "remote.token"
  }

  private(set) var config: RemoteConfig?
  /// Why the phone is back on the pairing screen (revoked, or an old pairing).
  private(set) var pairNotice: String?
  private(set) var catalog: RemoteCatalog
  private(set) var catalogError: String?
  private(set) var lastCatalogRefresh: Date?
  /// Models inside each agent, keyed by agent id. Empty until fetched, and on
  /// Macs that predate model choice.
  private(set) var agentModels: [String: [RemoteAgentModel]] = [:]
  private(set) var loadingAgentModels = false
  /// False once the Mac answered 404: its Pipper predates model choice.
  private(set) var agentModelsSupported = true
  private(set) var agentModelsError: String?

  let catalogStore = CatalogStore.standard()
  private let submissions = RemoteSubmissionStore()
  #if DEBUG
  private var isPreview = false
  #endif

  func createThread(
    projectId: String, agentId: String?, model: String? = nil, prompt: String
  ) async throws -> RemoteThreadSummary {
    guard let client, let config else { throw RemoteClientError.notPaired }
    // `model` joins the scope only when set, keeping pending IDs from before
    // model choice stable.
    let scope = [config.baseURL.absoluteString, "create", projectId, agentId ?? ""]
      + (model.map { ["model:\($0)"] } ?? []) + [prompt]
    let id = try submissions.requestId(for: scope)
    do {
      let thread = try await client.createThread(
        projectId: projectId, agentId: agentId, model: model, prompt: prompt, requestId: id)
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
    let scope = [config.baseURL.absoluteString, "prompt", threadId, prompt]
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
    if let data = defaults.data(forKey: Keys.laptop),
      var stored = try? JSONDecoder().decode(RemoteConfig.self, from: data),
      let token = Keychain.read(Keys.deviceToken), !token.isEmpty
    {
      stored.token = token
      config = stored
    }
    catalog = catalogStore.load() ?? .empty
    lastCatalogRefresh = catalogStore.modifiedAt
    if defaults.string(forKey: Keys.legacyHost) != nil || Keychain.read(Keys.legacyToken) != nil {
      defaults.removeObject(forKey: Keys.legacyHost)
      defaults.removeObject(forKey: Keys.legacyPort)
      Keychain.delete(Keys.legacyToken)
      if config == nil {
        catalogStore.clear()
        catalog = .empty
        lastCatalogRefresh = nil
        pairNotice =
          "Pipper now pairs each phone with a one-time code. On your Mac, open Settings → Remote → Pair a phone, then scan the new QR."
      }
    }
  }

  #if DEBUG
  /// Preview-only initializer: seeds a catalog without touching the Keychain,
  /// UserDefaults, or the shared on-disk cache. The paired state uses a dummy
  /// config, while `client` remains nil so previews never make network requests.
  init(previewCatalog: RemoteCatalog, paired: Bool = false, agentModels: [String: [RemoteAgentModel]] = [:]) {
    self.agentModels = agentModels
    config =
      paired
      ? RemoteConfig(
        baseURL: URL(string: "https://lt-preview.pipper.dev")!, token: "preview", laptopName: "Studio",
        owner: LaptopOwner(sub: "preview", email: "me@example.com", name: nil))
      : nil
    catalog = previewCatalog
    catalogError = nil
    lastCatalogRefresh = nil
    lastSiriThreadId = nil
    isPreview = true
  }

  /// A detached session for SwiftUI previews.
  static func preview(
    catalog: RemoteCatalog = .empty, paired: Bool = false, agentModels: [String: [RemoteAgentModel]] = [:]
  ) -> RemoteSession {
    RemoteSession(previewCatalog: catalog, paired: paired, agentModels: agentModels)
  }
  #endif

  var isPaired: Bool { config?.isComplete == true }

  var client: RemoteClient? {
    #if DEBUG
    if isPreview { return nil }
    #endif
    guard let config, config.isComplete else { return nil }
    let token = config.token
    return RemoteClient(config: config) {
      // The laptop revoked this phone (or its access expired). Only drop the
      // pairing that was refused, not one made since the request started.
      Task { @MainActor in
        let session = RemoteSession.shared
        guard session.config?.token == token else { return }
        session.forget(notice: "Your Mac removed this phone, or its access expired. Pair again to use it.")
      }
    }
  }

  /// Name this phone gets in the laptop's device list.
  static var deviceName: String { "\(UIDevice.current.model) · Pipper app" }

  /// Redeem a confirmed pairing link and keep this phone's device token.
  /// The token goes to the Keychain; the laptop's address and owner to defaults.
  func pair(_ link: PairingLink, owner: LaptopOwner?) async throws {
    let paired = try await RemoteClient.redeemPairing(link, deviceName: Self.deviceName)
    let next = RemoteConfig(
      baseURL: link.baseURL, token: paired.token, laptopName: paired.laptop?.name, owner: owner,
      deviceName: paired.device.name)
    try Keychain.write(Keys.deviceToken, value: next.token)
    var stored = next
    stored.token = ""
    UserDefaults.standard.set(try JSONEncoder().encode(stored), forKey: Keys.laptop)
    if config?.baseURL != next.baseURL { clearCatalog() }
    config = next
    pairNotice = nil
    await refreshCatalog()
  }

  /// Unpair from Settings: revoke on the laptop first (best effort), so the
  /// token is dead even if it leaked, then forget it here.
  func unpair() async {
    try? await client?.revokeThisDevice()
    forget(notice: nil)
  }

  private func forget(notice: String?) {
    UserDefaults.standard.removeObject(forKey: Keys.laptop)
    Keychain.delete(Keys.deviceToken)
    lastSiriThreadId = nil
    clearCatalog()
    config = nil
    pairNotice = notice
  }

  private func clearCatalog() {
    catalogStore.clear()
    catalog = .empty
    lastCatalogRefresh = nil
    agentModels = [:]
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

  /// Best effort: an older Mac (404) or a slow agent probe leaves the last
  /// list in place, and the picker falls back to the agent's default.
  func refreshAgentModels() async {
    guard let client, !loadingAgentModels else { return }
    loadingAgentModels = true
    defer { loadingAgentModels = false }
    do {
      agentModels = try await client.agentModels()
      agentModelsSupported = true
      agentModelsError = nil
    } catch RemoteClientError.http(status: 404, _) {
      agentModelsSupported = false
      agentModelsError = nil
    } catch {
      agentModelsError = error.localizedDescription
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

  /// Milliseconds since 1970, like `lastUsedAt` from the Mac.
  private static func minutesAgo(_ minutes: Double) -> Double {
    (Date().timeIntervalSince1970 - minutes * 60) * 1000
  }

  static let threads: [RemoteThreadSummary] = [
    RemoteThreadSummary(
      id: "a1b2c3d4-0000-0000-0000-000000000001", projectId: "folklore",
      worktreePath: "~/code/folklore/.worktrees/a1b2c3d4", title: "Add dark mode toggle",
      running: true, lastUsedAt: minutesAgo(1)),
    RemoteThreadSummary(
      id: "e5f6a7b8-0000-0000-0000-000000000002", projectId: "omni",
      worktreePath: nil, title: "Summarize the launch plan", running: false, lastUsedAt: minutesAgo(25)),
    RemoteThreadSummary(
      id: "c9d0e1f2-0000-0000-0000-000000000003", projectId: "folklore",
      worktreePath: "~/code/folklore/.worktrees/c9d0e1f2", title: nil, running: false,
      lastUsedAt: minutesAgo(90)),
    RemoteThreadSummary(
      id: "d3e4f5a6-0000-0000-0000-000000000004", projectId: "omni",
      worktreePath: "~/code/omni/.worktrees/d3e4f5a6", title: "Read the codebase", running: false,
      lastUsedAt: minutesAgo(60 * 26)),
    RemoteThreadSummary(
      id: "b7c8d9e0-0000-0000-0000-000000000005", projectId: "folklore",
      worktreePath: "~/code/folklore/.worktrees/b7c8d9e0", title: "Fix onboarding crash", running: false,
      lastUsedAt: minutesAgo(60 * 24 * 3)),
  ]

  static let agentModels: [String: [RemoteAgentModel]] = [
    "codex": [
      RemoteAgentModel(id: "gpt-5", name: "GPT-5"),
      RemoteAgentModel(id: "gpt-5-codex", name: "GPT-5 Codex"),
    ],
    "claude": [
      RemoteAgentModel(id: "sonnet", name: "Sonnet"),
      RemoteAgentModel(id: "opus", name: "Opus"),
    ],
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
          "## Dark mode\n\nDone. I added a **Dark mode** toggle to `SettingsView`, bound to `@AppStorage(\"darkMode\")`.\n\n- Toggle in Settings\n- Applies `preferredColorScheme` at the root\n\n```swift\n@AppStorage(\"darkMode\") private var darkMode = false\n```\n\n| File | Change |\n| --- | --- |\n| SettingsView.swift | Added toggle |\n| PipperRemoteApp.swift | Applies scheme |"
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
    request: nil,
    model: RemoteThreadModel(current: "gpt-5", options: agentModels["codex"] ?? []))

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
