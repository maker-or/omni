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
  @Test func projectOptionsProviderListsProjects() async throws {
    let catalog = makeCatalog(projects: [
      SiriCatalogProject(id: "p1", name: "My App", path: "/tmp/a"),
      SiriCatalogProject(id: "p2", name: "Other", path: "/tmp/b"),
    ], agents: [SiriCatalogAgent(id: "codex-acp", displayName: "Codex", available: true)])
    try await withTempCatalog(catalog) {
      let items = try await ProjectOptionsProvider().results()
      #expect(items.sections.first?.items.count == 2)
    }
  }

  @Test func agentOptionsProviderFiltersUnavailable() async throws {
    let catalog = makeCatalog(agents: [
      SiriCatalogAgent(id: "codex-acp", displayName: "Codex", available: true),
      SiriCatalogAgent(id: "opencode-acp", displayName: "opencode", available: false),
    ])
    try await withTempCatalog(catalog) {
      let items = try await AgentOptionsProvider().results()
      #expect(items.sections.first?.items.count == 1)
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
      intent.projectId = "p1"
      intent.agentId = "codex-acp"
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
      intent.projectId = "p1"
      intent.agentId = "codex-acp"
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
  @Test func optionsProvidersResolveRealIds() async throws {
    let catalog = SiriCatalog(
      version: 1, updatedAt: "2026-09-09T09:03:09.283Z", defaultAgentId: "cursor-acp",
      projects: [SiriCatalogProject(id: "bae0366a-9087-4e4c-966d-bd4ef5ce1295", name: "FolkLore-LiveLore-", path: "/Users/me/code/FolkLore-LiveLore-")],
      agents: [SiriCatalogAgent(id: "opencode-acp", displayName: "opencode", available: true)]
    )
    try await withTempCatalog(catalog) {
      let projects = try await ProjectOptionsProvider().results()
      #expect(projects.sections.first?.items.count == 1)
      let agents = try await AgentOptionsProvider().results()
      #expect(agents.sections.first?.items.count == 1)
    }
  }
}
