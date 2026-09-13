import Foundation

// Wire shapes for the laptop's RemoteServer (electron/remote-server.ts).
// Keep in sync with contracts/remote.ts and electron/siri/siri-catalog.ts.

public struct RemoteCatalogProject: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var name: String
  public var path: String

  public init(id: String, name: String, path: String) {
    self.id = id
    self.name = name
    self.path = path
  }
}

public struct RemoteCatalogAgent: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var displayName: String
  public var available: Bool

  public init(id: String, displayName: String, available: Bool) {
    self.id = id
    self.displayName = displayName
    self.available = available
  }
}

/// Same document the macOS extension reads from `siri-catalog.json`; served
/// to the phone by `GET /api/remote/catalog` and cached on disk so Siri can
/// resolve projects/agents without a network hop.
public struct RemoteCatalog: Codable, Equatable, Sendable {
  public var version: Int
  public var updatedAt: String
  public var defaultAgentId: String
  public var projects: [RemoteCatalogProject]
  public var agents: [RemoteCatalogAgent]

  public init(
    version: Int = 1,
    updatedAt: String,
    defaultAgentId: String,
    projects: [RemoteCatalogProject],
    agents: [RemoteCatalogAgent]
  ) {
    self.version = version
    self.updatedAt = updatedAt
    self.defaultAgentId = defaultAgentId
    self.projects = projects
    self.agents = agents
  }

  public static let empty = RemoteCatalog(updatedAt: "", defaultAgentId: "", projects: [], agents: [])

  public var availableAgents: [RemoteCatalogAgent] { agents.filter(\.available) }

  /// Preferred agent for a Siri request that named no agent: the laptop's
  /// default when it is installed, else the first available one.
  public var preferredAgent: RemoteCatalogAgent? {
    if let d = agents.first(where: { $0.id == defaultAgentId && $0.available }) { return d }
    return availableAgents.first
  }

  public func project(id: String) -> RemoteCatalogProject? {
    projects.first { $0.id == id }
  }

  public func agent(id: String) -> RemoteCatalogAgent? {
    agents.first { $0.id == id }
  }

  /// Case-insensitive match for spoken/typed project names. Exact name wins,
  /// then prefix, then substring — Siri passes the transcribed phrase here.
  public func projects(matching query: String) -> [RemoteCatalogProject] {
    RemoteCatalog.rank(projects, query: query, key: \.name)
  }

  public func agents(matching query: String) -> [RemoteCatalogAgent] {
    RemoteCatalog.rank(availableAgents, query: query, key: \.displayName)
  }

  static func rank<T>(_ items: [T], query: String, key: KeyPath<T, String>) -> [T] {
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !q.isEmpty else { return items }
    let folded = { (s: String) in s.lowercased() }
    let exact = items.filter { folded($0[keyPath: key]) == q }
    let prefix = items.filter {
      let n = folded($0[keyPath: key])
      return n != q && n.hasPrefix(q)
    }
    let contains = items.filter {
      let n = folded($0[keyPath: key])
      return n != q && !n.hasPrefix(q) && n.contains(q)
    }
    return exact + prefix + contains
  }
}

public struct RemoteThreadSummary: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var projectId: String
  public var worktreePath: String?
  public var title: String?
  public var running: Bool
  public var lastUsedAt: Double

  public init(
    id: String, projectId: String, worktreePath: String?, title: String?, running: Bool,
    lastUsedAt: Double
  ) {
    self.id = id
    self.projectId = projectId
    self.worktreePath = worktreePath
    self.title = title
    self.running = running
    self.lastUsedAt = lastUsedAt
  }
}

public struct RemoteMessage: Codable, Hashable, Sendable {
  public enum Role: String, Codable, Sendable {
    case user
    case agent
  }
  public var role: Role
  public var text: String

  public init(role: Role, text: String) {
    self.role = role
    self.text = text
  }
}

public struct RemoteReport: Codable, Equatable, Sendable {
  public var threadId: String
  public var running: Bool
  public var summary: String?
  public var finalText: String?
  public var messages: [RemoteMessage]
  public var projectName: String?
  public var filesTouched: [String]
  public var worktreePath: String?
  public var isolated: Bool
  public var isolationNote: String?
}
