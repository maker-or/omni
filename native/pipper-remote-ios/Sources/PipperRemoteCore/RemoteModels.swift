import Foundation

// Wire shapes for the laptop's RemoteServer (electron/remote-server.ts).
// Keep in sync with contracts/remote.ts and electron/siri/siri-catalog.ts.

public struct RemoteCatalogProject: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var name: String
  public var path: String
}

public struct RemoteCatalogAgent: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var displayName: String
  public var available: Bool
}

/// Same document the macOS extension reads from `siri-catalog.json`; served
/// to the phone by `GET /api/remote/catalog` and cached on disk so Siri can
/// resolve projects/agents without a network hop.
public struct RemoteCatalog: Codable, Equatable, Sendable {
  public var version: Int = 1
  public var updatedAt: String
  public var defaultAgentId: String
  public var projects: [RemoteCatalogProject]
  public var agents: [RemoteCatalogAgent]

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

/// A model offered inside one agent (the ACP session's model option), from
/// `GET /api/remote/agent-models`.
public struct RemoteAgentModel: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var name: String
}

/// A thread's current model and what it can switch to.
public struct RemoteThreadModel: Codable, Equatable, Sendable {
  public var current: String?
  public var options: [RemoteAgentModel]

  public var currentName: String? {
    current.map { id in options.first { $0.id == id }?.name ?? id }
  }
}

public struct RemoteThreadSummary: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var projectId: String
  public var worktreePath: String?
  public var title: String?
  public var running: Bool
  public var lastUsedAt: Double
}

extension RemoteThreadSummary {
  /// Name Siri and Shortcuts show for the thread.
  public var displayTitle: String {
    let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? "Untitled thread" : trimmed
  }

  /// Most recently used first, the order intents suggest threads in.
  public static func recentFirst(_ threads: [RemoteThreadSummary]) -> [RemoteThreadSummary] {
    threads.sorted { $0.lastUsedAt > $1.lastUsedAt }
  }

  /// Case-insensitive title or project-name match for typed/spoken queries.
  /// Exact title wins, then prefix, then substring; ties keep recent-first.
  public static func matching(
    _ query: String, in threads: [RemoteThreadSummary], projectName: (String) -> String?
  ) -> [RemoteThreadSummary] {
    let recent = recentFirst(threads)
    let byTitle = RemoteCatalog.rank(recent, query: query, key: \.displayTitle)
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !q.isEmpty else { return byTitle }
    let titled = Set(byTitle.map(\.id))
    let byProject = recent.filter {
      !titled.contains($0.id) && (projectName($0.projectId)?.lowercased().contains(q) ?? false)
    }
    return byTitle + byProject
  }
}

public struct RemoteMessage: Codable, Hashable, Sendable {
  public enum Role: String, Codable, Sendable {
    case user
    case agent
  }
  public var role: Role
  public var text: String
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
  public var permissions: [RemotePermission]?
  public var request: RemoteRequestStatus?
  /// Nil on older Macs, for threads not loaded on the Mac, or agents with no model choice.
  public var model: RemoteThreadModel?
}

extension RemoteReport {
  /// The agent's most recent reply, falling back to the joined transcript tail.
  public var latestAgentText: String? {
    let latest = messages.last(where: { $0.role == .agent })?.text ?? finalText
    let trimmed = latest?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
  }

  /// One or two short sentences Siri can read aloud: whether the thread is
  /// blocked on the user, failed, still working, or done, plus a snippet of
  /// the agent's latest reply with Markdown removed.
  public func spokenStatus(maxSnippet: Int = 240) -> String {
    if let decision = permissions?.first {
      return "It's waiting for you: \(SpokenText.plain(decision.title, limit: maxSnippet)) Open Pipper to answer."
    }
    if let request, request.state == "failed" || request.state == "interrupted" {
      let why = request.error.map { " \(SpokenText.plain($0, limit: maxSnippet))" } ?? ""
      return request.state == "failed"
        ? "The last request failed.\(why)"
        : "The last request was interrupted.\(why) Check the thread before resending."
    }
    let snippet = latestAgentText.map { SpokenText.plain($0, limit: maxSnippet) } ?? ""
    if running {
      return snippet.isEmpty ? "It's still working." : "It's still working. Latest: \(snippet)"
    }
    let files =
      filesTouched.isEmpty
      ? "" : " Changed \(filesTouched.count) file\(filesTouched.count == 1 ? "" : "s")."
    return snippet.isEmpty ? "It's finished.\(files)" : "It's finished.\(files) \(snippet)"
  }
}

/// Turns agent Markdown into short plain text for Siri to speak.
public enum SpokenText {
  public static func plain(_ markdown: String, limit: Int) -> String {
    var lines: [String] = []
    var inFence = false
    for raw in markdown.components(separatedBy: .newlines) {
      let line = raw.trimmingCharacters(in: .whitespaces)
      if line.hasPrefix("```") || line.hasPrefix("~~~") {
        inFence.toggle()
        continue
      }
      // Code and tables don't read aloud; drop them rather than spell them out.
      if inFence || line.hasPrefix("|") || line.isEmpty { continue }
      var text = line
      for marker in ["#", ">", "- ", "* ", "+ "] where text.hasPrefix(marker) {
        text = String(text.drop(while: { marker.contains($0) })).trimmingCharacters(in: .whitespaces)
      }
      text = text.replacingOccurrences(of: #"\[([^\]]*)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
      text = text.replacingOccurrences(of: #"\*\*|__|`|~~"#, with: "", options: .regularExpression)
      if !text.isEmpty { lines.append(text) }
    }
    let joined = lines.map { line in
      line.last.map { ".!?:;".contains($0) } == true ? line : line + "."
    }.joined(separator: " ")
    return truncate(joined, limit: limit)
  }

  /// Cut at the last sentence end within `limit`, else the last word, adding "…".
  static func truncate(_ text: String, limit: Int) -> String {
    guard text.count > limit, limit > 0 else { return text }
    let head = String(text.prefix(limit))
    if let end = head.lastIndex(where: { ".!?".contains($0) }), head.distance(from: head.startIndex, to: end) >= limit / 2 {
      return String(head[...end])
    }
    let words = head.split(separator: " ").dropLast()
    let cut = words.isEmpty ? head : words.joined(separator: " ")
    return cut + "…"
  }
}

public struct RemotePermission: Codable, Equatable, Sendable, Identifiable {
  public var id: String
  public var title: String
  public var detail: String?
  public var options: [Option]

  public struct Option: Codable, Equatable, Sendable, Identifiable {
    public var optionId: String
    public var name: String
    public var kind: String
    public var id: String { optionId }
  }
}

public struct RemoteRequestStatus: Codable, Equatable, Sendable {
  public var id: String
  public var threadId: String?
  public var state: String
  public var error: String?
  public var updatedAt: Double
}

public struct RemoteDiagnostics: Codable, Equatable, Sendable {
  public var paired: Bool
  public var agentReady: Bool
  public var availableAgents: Int
  public var projects: Int

  public var ready: Bool { paired && agentReady && availableAgents > 0 && projects > 0 }
  public var guidance: String {
    if !agentReady { return "Open Pipper on your Mac and wait for startup to finish." }
    if availableAgents == 0 { return "Install and select a coding agent in Pipper on your Mac." }
    if projects == 0 { return "Add a Git project in Pipper on your Mac." }
    return "Ready. Start a sample task to check the full connection."
  }
}

// MARK: Pairing (contracts/remote.ts: RemoteLaptopIdentity, RemoteDevice, RemotePairResponse)

/// How a laptop introduces itself to a phone that holds a valid code.
public struct RemoteLaptopIdentity: Codable, Equatable, Sendable {
  public var name: String
  public var host: String?
  /// pipper.dev's signed owner statement (named tunnels only).
  public var attestation: String?
}

/// This phone as the laptop lists it under Settings → Remote.
public struct RemoteDevice: Codable, Equatable, Sendable {
  public var id: String
  public var name: String
  /// "read" and/or "run"; kept as strings so a new scope can't break decoding.
  public var scopes: [String]

  public var canRun: Bool { scopes.contains("run") }
}

public struct RemotePairResponse: Codable, Equatable, Sendable {
  public var token: String
  public var device: RemoteDevice
  public var laptop: RemoteLaptopIdentity?
}
