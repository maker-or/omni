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
