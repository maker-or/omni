import Foundation
import Testing
@testable import PipperIntents

private func withTempCatalog(_ catalog: SiriCatalog, perform: () async throws -> Void) async throws {
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pipper-test-\(UUID().uuidString)", isDirectory: true)
  try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  // Use PIPPER_LIBRARY_PATH override so SiriCatalogStore reads from temp dir
  setenv("PIPPER_LIBRARY_PATH", dir.path, 1)
  defer { unsetenv("PIPPER_LIBRARY_PATH"); try? FileManager.default.removeItem(at: dir) }
  let data = try JSONEncoder().encode(catalog)
  try data.write(to: dir.appendingPathComponent("siri-catalog.json"), options: .atomic)
  try await perform()
}

private func makeCatalog(projects: [SiriCatalogProject] = [], agents: [SiriCatalogAgent] = [], defaultAgentId: String = "codex-acp") -> SiriCatalog {
  SiriCatalog(version: 1, updatedAt: ISO8601DateFormatter().string(from: Date()), defaultAgentId: defaultAgentId, projects: projects, agents: agents)
}

@Suite("PipperIntents end-to-end", .serialized)
struct PipperIntentsTests {
  @Test func projectQuerySuggestedEntities() async throws {
    let catalog = makeCatalog(projects: [
      SiriCatalogProject(id: "p1", name: "My App", path: "/tmp/a"),
      SiriCatalogProject(id: "p2", name: "Other", path: "/tmp/b"),
    ], agents: [SiriCatalogAgent(id: "codex-acp", displayName: "Codex", available: true)])
    try await withTempCatalog(catalog) {
      let q = ProjectEntityQuery()
      let all = try await q.allEntities()
      #expect(all.count == 2)
      let suggested = try await q.suggestedEntities()
      #expect(suggested.count == 2)
    }
  }

  @Test func projectQueryMatchingFilters() async throws {
    let catalog = makeCatalog(projects: [
      SiriCatalogProject(id: "p1", name: "My App", path: "/Users/me/my-app"),
      SiriCatalogProject(id: "p2", name: "Dotfiles", path: "/Users/me/dotfiles"),
    ])
    try await withTempCatalog(catalog) {
      let q = ProjectEntityQuery()
      let matched = try await q.entities(matching: "my app")
      #expect(matched.count == 1)
      #expect(matched.first?.id == "p1")
      let byPath = try await q.entities(matching: "dotfiles")
      #expect(byPath.first?.id == "p2")
    }
  }

  @Test func projectQueryForIdentifiers() async throws {
    let catalog = makeCatalog(projects: [SiriCatalogProject(id: "p1", name: "A", path: "/a")])
    try await withTempCatalog(catalog) {
      let q = ProjectEntityQuery()
      let res = try await q.entities(for: ["p1", "missing"])
      #expect(res.count == 1 && res.first?.id == "p1")
    }
  }

  @Test func agentQueryFiltersUnavailable() async throws {
    let catalog = makeCatalog(agents: [
      SiriCatalogAgent(id: "codex-acp", displayName: "Codex", available: true),
      SiriCatalogAgent(id: "opencode-acp", displayName: "opencode", available: false),
    ])
    try await withTempCatalog(catalog) {
      let q = AgentEntityQuery()
      let all = try await q.allEntities()
      #expect(all.count == 1 && all.first?.id == "codex-acp")
    }
  }

  @Test func startThreadIntentStagesRequest() async throws {
    let catalog = makeCatalog(
      projects: [SiriCatalogProject(id: "p1", name: "My App", path: "/tmp/a")],
      agents: [SiriCatalogAgent(id: "codex-acp", displayName: "Codex", available: true)],
      defaultAgentId: "codex-acp"
    )
    try await withTempCatalog(catalog) {
        let intent = StartThreadIntent()
      // Resolve entities via queries to match Siri's flow
      let project = try await ProjectEntityQuery().entities(for: ["p1"]).first!
      let agent = try await AgentEntityQuery().entities(for: ["codex-acp"]).first!
      intent.project = project
      intent.agent = agent
      intent.prompt = "Fix login bug"
      let result = try await intent.perform()
      // Verify file staged
      let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["PIPPER_LIBRARY_PATH"]!)
      let requests = try FileManager.default.contentsOfDirectory(at: dir.appendingPathComponent("siri-requests"), includingPropertiesForKeys: nil)
      #expect(requests.count == 1)
      let data = try Data(contentsOf: requests[0])
      let json = try JSONSerialization.jsonObject(with: data) as! [String: String]
      #expect(json["projectId"] == "p1")
      #expect(json["agentId"] == "codex-acp")
      #expect(json["prompt"] == "Fix login bug")
      _ = result
    }
  }

  @Test func startThreadIntentRequiresAndStagesChosenAgent() async throws {
    let catalog = makeCatalog(
      projects: [SiriCatalogProject(id: "p1", name: "My App", path: "/tmp/a")],
      agents: [SiriCatalogAgent(id: "codex-acp", displayName: "Codex", available: true)],
      defaultAgentId: "codex-acp"
    )
    try await withTempCatalog(catalog) {
      let intent = StartThreadIntent()
      intent.project = try await ProjectEntityQuery().entities(for: ["p1"]).first!
      intent.agent = try await AgentEntityQuery().entities(for: ["codex-acp"]).first!
      intent.prompt = "Hello"
      _ = try await intent.perform()
      let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["PIPPER_LIBRARY_PATH"]!)
      let file = try FileManager.default.contentsOfDirectory(at: dir.appendingPathComponent("siri-requests"), includingPropertiesForKeys: nil).first!
      let json = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: String]
      #expect(json["agentId"] == "codex-acp")
    }
  }
}

extension PipperIntentsTests {
  @Test func entitiesForResolvesRealIds() async throws {
    let catalog = SiriCatalog(
      version: 1, updatedAt: "2026-09-09T09:03:09.283Z", defaultAgentId: "cursor-acp",
      projects: [SiriCatalogProject(id: "bae0366a-9087-4e4c-966d-bd4ef5ce1295", name: "FolkLore-LiveLore-", path: "/Users/me/code/FolkLore-LiveLore-")],
      agents: [SiriCatalogAgent(id: "opencode-acp", displayName: "opencode", available: true)]
    )
    try await withTempCatalog(catalog) {
      let projects = try await ProjectEntityQuery().entities(for: ["bae0366a-9087-4e4c-966d-bd4ef5ce1295"])
      #expect(projects.count == 1)
      #expect(projects.first?.name == "FolkLore-LiveLore-")
    }
  }
}
