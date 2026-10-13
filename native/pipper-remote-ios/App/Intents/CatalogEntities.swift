import AppIntents
import Foundation

/// Reads the catalog for Siri parameter resolution. Cached copy first (must
/// work offline and fast); falls back to a network fetch only when the cache
/// is empty, so a fresh install still works right after pairing.
enum IntentCatalog {
  static func current() async -> RemoteCatalog {
    let session = await MainActor.run { RemoteSession.shared }
    let cached = await MainActor.run { session.catalog }
    if !cached.projects.isEmpty { return cached }
    return await session.refreshCatalog() ?? cached
  }
}

struct ProjectEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Project"
  static var defaultQuery = ProjectQuery()

  var id: String
  var name: String
  var path: String

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(
      title: "\(name)",
      subtitle: "\(path)",
      image: .init(systemName: "folder"))
  }

  init(_ project: RemoteCatalogProject) {
    id = project.id
    name = project.name
    path = project.path
  }
}

struct ProjectQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [ProjectEntity] {
    let catalog = await IntentCatalog.current()
    return identifiers.compactMap { catalog.project(id: $0) }.map(ProjectEntity.init)
  }

  func entities(matching string: String) async throws -> [ProjectEntity] {
    await IntentCatalog.current().projects(matching: string).map(ProjectEntity.init)
  }

  func suggestedEntities() async throws -> [ProjectEntity] {
    await IntentCatalog.current().projects.map(ProjectEntity.init)
  }
}

struct AgentEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Agent"
  static var defaultQuery = AgentQuery()

  var id: String
  var displayName: String

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(displayName)", image: .init(systemName: "cpu"))
  }

  init(_ agent: RemoteCatalogAgent) {
    id = agent.id
    displayName = agent.displayName
  }
}

struct AgentQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [AgentEntity] {
    let catalog = await IntentCatalog.current()
    // Accept unavailable ids here so a saved Shortcut still decodes; perform()
    // re-checks availability at run time.
    return identifiers.compactMap { catalog.agent(id: $0) }.map(AgentEntity.init)
  }

  func entities(matching string: String) async throws -> [AgentEntity] {
    await IntentCatalog.current().agents(matching: string).map(AgentEntity.init)
  }

  func suggestedEntities() async throws -> [AgentEntity] {
    await IntentCatalog.current().availableAgents.map(AgentEntity.init)
  }
}

/// A thread on the Mac. Unlike projects and agents, threads aren't cached:
/// they change on every run, so each query asks the Mac for its latest list.
struct ThreadEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Thread"
  static var defaultQuery = ThreadQuery()

  var id: String
  var title: String
  var projectName: String?
  var running: Bool

  var displayRepresentation: DisplayRepresentation {
    let state = running ? "Running" : "Idle"
    return DisplayRepresentation(
      title: "\(title)",
      subtitle: "\(projectName.map { "\($0) · \(state)" } ?? state)",
      image: .init(systemName: running ? "bubble.left.and.text.bubble.right.fill" : "bubble.left.and.text.bubble.right"))
  }

  init(_ thread: RemoteThreadSummary, catalog: RemoteCatalog) {
    id = thread.id
    title = thread.displayTitle
    projectName = catalog.project(id: thread.projectId)?.name
    running = thread.running
  }

  /// Stand-in for a saved thread the Mac can't list right now, so a saved
  /// Shortcut still reaches `perform()` and reports the real error.
  init(unlisted id: String) {
    self.id = id
    title = "Pipper thread"
    projectName = nil
    running = false
  }
}

enum IntentThreads {
  /// The Mac's threads, most recently used first.
  static func list() async throws -> [RemoteThreadSummary] {
    guard let client = await MainActor.run(body: { RemoteSession.shared.client }) else {
      throw StartThreadError.notPaired
    }
    do {
      return RemoteThreadSummary.recentFirst(try await client.listThreads())
    } catch {
      throw StartThreadError.remote(error.localizedDescription)
    }
  }

  /// The named thread, else the one most recently used on the Mac.
  static func resolve(_ entity: ThreadEntity?) async throws -> ThreadEntity {
    if let entity { return entity }
    let threads = try await list()
    guard let latest = threads.first else { throw StartThreadError.noThreads }
    return ThreadEntity(latest, catalog: await IntentCatalog.current())
  }
}

struct ThreadQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [ThreadEntity] {
    let threads = (try? await IntentThreads.list()) ?? []
    let catalog = await IntentCatalog.current()
    return identifiers.map { id in
      threads.first { $0.id == id }.map { ThreadEntity($0, catalog: catalog) } ?? ThreadEntity(unlisted: id)
    }
  }

  func entities(matching string: String) async throws -> [ThreadEntity] {
    let catalog = await IntentCatalog.current()
    return RemoteThreadSummary.matching(
      string, in: try await IntentThreads.list(), projectName: { catalog.project(id: $0)?.name }
    ).map { ThreadEntity($0, catalog: catalog) }
  }

  func suggestedEntities() async throws -> [ThreadEntity] {
    let catalog = await IntentCatalog.current()
    return try await IntentThreads.list().prefix(20).map { ThreadEntity($0, catalog: catalog) }
  }
}
