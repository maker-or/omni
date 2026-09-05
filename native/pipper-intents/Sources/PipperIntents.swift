import AppIntents
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
  static func catalogURL() -> URL {
    let home = FileManager.default.homeDirectoryForCurrentUser
    return home
      .appendingPathComponent("Library/pipper/siri-catalog.json")
  }

  static func requestsDir() -> URL {
    let home = FileManager.default.homeDirectoryForCurrentUser
    return home.appendingPathComponent("Library/pipper/siri-requests")
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
  func entities(for identifiers: [String]) async throws -> [AgentEntity] {
    let all = SiriCatalogStore.load()?.agents ?? []
    return all.filter { identifiers.contains($0.id) }.map {
      AgentEntity(id: $0.id, name: $0.displayName, available: $0.available)
    }
  }

  func suggestedEntities() async throws -> [AgentEntity] {
    try await allEntities()
  }

  func allEntities() async throws -> [AgentEntity] {
    let all = SiriCatalogStore.load()?.agents ?? []
    return all.map { AgentEntity(id: $0.id, name: $0.displayName, available: $0.available) }
  }

  func entities(matching string: String) async throws -> [AgentEntity] {
    let all = SiriCatalogStore.load()?.agents ?? []
    return all.filter { $0.displayName.localizedCaseInsensitiveContains(string) }.map {
      AgentEntity(id: $0.id, name: $0.displayName, available: $0.available)
    }
  }
}

enum SiriRequestError: Error, CustomLocalizedStringResourceConvertible {
  case encodingFailed
  case stagingFailed

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .encodingFailed: return "Couldn't prepare the thread request."
    case .stagingFailed: return "Couldn't save the thread request. Please try again."
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
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Project") var project: ProjectEntity
  @Parameter(title: "Agent") var agent: AgentEntity?
  @Parameter(title: "Task", requestValueDialog: "What should the thread work on?") var prompt: String?

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let catalog = SiriCatalogStore.load()
    let agentId = agent?.id ?? catalog?.defaultAgentId
    // Confirm-then-create: stage a pending request; Electron creates the
    // thread when the app opens (user already confirmed the snippet card).
    let requestId = UUID().uuidString
    let payload: [String: String] = [
      "requestId": requestId,
      "projectId": project.id,
      "agentId": agentId ?? "",
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
    } catch {
      throw SiriRequestError.stagingFailed
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
