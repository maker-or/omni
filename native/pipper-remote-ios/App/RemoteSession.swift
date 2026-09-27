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

  var isPaired: Bool { config?.isComplete == true }

  var client: RemoteClient? {
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
