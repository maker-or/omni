import AppIntents
import AppKit
import Foundation

// MARK: - Shared catalog (written by Electron, read by Siri)

struct SiriCatalogProject: Codable, Sendable {
  var id: String
  var name: String
  var path: String
}

struct SiriCatalogAgent: Codable, Sendable {
  var id: String
  var displayName: String
  var available: Bool
}

struct SiriCatalog: Codable, Sendable {
  var version: Int
  var updatedAt: String
  var defaultAgentId: String
  var projects: [SiriCatalogProject]
  var agents: [SiriCatalogAgent]
}

enum SiriCatalogStore {
  /// Base directory shared with Electron. Honors the same PIPPER_LIBRARY_PATH
  /// override so both sides never diverge.
  static func baseDir() -> URL {
    if let overridePath = ProcessInfo.processInfo.environment["PIPPER_LIBRARY_PATH"],
      !overridePath.isEmpty
    {
      return URL(fileURLWithPath: overridePath, isDirectory: true)
    }
    return FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/pipper", isDirectory: true)
  }

  static func catalogURL() -> URL {
    baseDir().appendingPathComponent("siri-catalog.json")
  }

  static func requestsDir() -> URL {
    baseDir().appendingPathComponent("siri-requests", isDirectory: true)
  }

  static func load() -> SiriCatalog? {
    guard let data = try? Data(contentsOf: catalogURL()) else { return nil }
    return try? JSONDecoder().decode(SiriCatalog.self, from: data)
  }
}

// MARK: - Entities (both dynamic -> AppEntity, not AppEnum)

struct ProjectEntity: AppEntity {
  var id: String
  var name: String
  var path: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Project"
  static var defaultQuery = ProjectEntityQuery()

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)", subtitle: "\(path)")
  }
}

struct ProjectEntityQuery: EnumerableEntityQuery, EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [ProjectEntity] {
    let all = SiriCatalogStore.load()?.projects ?? []
    return all.filter { identifiers.contains($0.id) }.map {
      ProjectEntity(id: $0.id, name: $0.name, path: $0.path)
    }
  }

  func suggestedEntities() async throws -> [ProjectEntity] {
    try await allEntities()
  }

  func allEntities() async throws -> [ProjectEntity] {
    let all = SiriCatalogStore.load()?.projects ?? []
    return all.map { ProjectEntity(id: $0.id, name: $0.name, path: $0.path) }
  }

  func entities(matching string: String) async throws -> [ProjectEntity] {
    let all = SiriCatalogStore.load()?.projects ?? []
    return all.filter {
      $0.name.localizedCaseInsensitiveContains(string)
        || $0.path.localizedCaseInsensitiveContains(string)
    }.map { ProjectEntity(id: $0.id, name: $0.name, path: $0.path) }
  }
}

struct AgentEntity: AppEntity {
  var id: String
  var name: String
  var available: Bool

  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Agent"
  static var defaultQuery = AgentEntityQuery()

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)")
  }
}

struct AgentEntityQuery: EnumerableEntityQuery, EntityStringQuery {
  /// Only usable agents are ever offered — staging a thread for a missing
  /// CLI would fail later in Electron.
  private func usableAgents() -> [SiriCatalogAgent] {
    (SiriCatalogStore.load()?.agents ?? []).filter { $0.available }
  }

  func entities(for identifiers: [String]) async throws -> [AgentEntity] {
    usableAgents().filter { identifiers.contains($0.id) }.map {
      AgentEntity(id: $0.id, name: $0.displayName, available: $0.available)
    }
  }

  func suggestedEntities() async throws -> [AgentEntity] {
    try await allEntities()
  }

  func allEntities() async throws -> [AgentEntity] {
    usableAgents().map {
      AgentEntity(id: $0.id, name: $0.displayName, available: $0.available)
    }
  }

  func entities(matching string: String) async throws -> [AgentEntity] {
    usableAgents().filter { $0.displayName.localizedCaseInsensitiveContains(string) }.map {
      AgentEntity(id: $0.id, name: $0.displayName, available: $0.available)
    }
  }
}

enum SiriRequestError: Error, CustomLocalizedStringResourceConvertible {
  case encodingFailed
  case stagingFailed
  case agentUnavailable(String)
  case openFailed

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .encodingFailed: return "Couldn't prepare the thread request."
    case .stagingFailed: return "Couldn't save the thread request. Please try again."
    case .agentUnavailable(let name):
      return "The agent \(name) isn't available. Pick an installed agent."
    case .openFailed: return "Couldn't open Pipper to create the thread."
    }
  }
}

// MARK: - Intent: start a thread (confirm-then-create)

struct StartThreadIntent: AppIntent {
  static var title: LocalizedStringResource = "Start Pipper thread"
  static var description = IntentDescription(
    "Starts a new thread in a Pipper project with a chosen agent.",
    categoryName: "Productivity"
  )
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Project") var project: ProjectEntity
  @Parameter(title: "Agent") var agent: AgentEntity?
  @Parameter(title: "Task", requestValueDialog: "What should the thread work on?") var prompt: String?

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let catalog = SiriCatalogStore.load()
    // Revalidate availability at run time: the catalog may have changed
    // between entity resolution and perform().
    let usableIds = Set((catalog?.agents ?? []).filter { $0.available }.map { $0.id })
    let defaultId = catalog?.defaultAgentId
    let resolvedAgentId: String?
    if let chosen = agent {
      guard usableIds.contains(chosen.id) else {
        throw SiriRequestError.agentUnavailable(chosen.name)
      }
      resolvedAgentId = chosen.id
    } else {
      resolvedAgentId = defaultId.flatMap { usableIds.contains($0) ? $0 : nil }
    }
    // Confirm-then-create: stage a pending request, then open Pipper on the
    // deep link so Electron consumes it and lands on the new thread.
    let requestId = UUID().uuidString
    let payload: [String: String] = [
      "requestId": requestId,
      "projectId": project.id,
      "agentId": resolvedAgentId ?? "",
      "prompt": prompt ?? "",
    ]
    let dir = SiriCatalogStore.requestsDir()
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let url = dir.appendingPathComponent("\(requestId).json")
      guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
        throw SiriRequestError.encodingFailed
      }
      try data.write(to: url, options: .atomic)
    } catch let error as SiriRequestError {
      throw error
    } catch {
      throw SiriRequestError.stagingFailed
    }
    guard let deepLink = URL(string: "pipper://siri/\(requestId)"),
      NSWorkspace.shared.open(deepLink)
    else {
      throw SiriRequestError.openFailed
    }
    return .result(
      dialog: "Starting a thread in \(project.name). Confirm in Pipper to create it."
    )
  }
}

// MARK: - Shortcuts registration (Siri phrases must contain applicationName)

struct PipperShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartThreadIntent(),
      phrases: [
        "Start a thread in \(.applicationName)",
        "New thread in \(.applicationName)",
        "Start a thread with \(.applicationName)",
      ],
      shortTitle: "Start thread",
      systemImageName: "bubble.left.and.text.bubble.right"
    )
  }
}
