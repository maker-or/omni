import Foundation
import Testing
@testable import PipperRemoteCore

// MARK: - URLProtocol stub so the client can be exercised without a laptop.

final class StubURLProtocol: URLProtocol {
  nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, Data))?
  nonisolated(unsafe) static var lastRequest: URLRequest?
  nonisolated(unsafe) static var lastBody: Data?

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    StubURLProtocol.lastRequest = request
    StubURLProtocol.lastBody = request.httpBody ?? request.httpBodyStream.map { stream in
      stream.open()
      defer { stream.close() }
      var data = Data()
      var buffer = [UInt8](repeating: 0, count: 4096)
      while stream.hasBytesAvailable {
        let n = stream.read(&buffer, maxLength: buffer.count)
        if n <= 0 { break }
        data.append(buffer, count: n)
      }
      return data
    }
    let (status, body) = StubURLProtocol.handler?(request) ?? (500, Data())
    let response = HTTPURLResponse(
      url: request.url!, statusCode: status, httpVersion: nil,
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: body)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

private func stubClient(_ handler: @escaping (URLRequest) -> (Int, Data)) -> RemoteClient {
  StubURLProtocol.handler = handler
  let c = URLSessionConfiguration.ephemeral
  c.protocolClasses = [StubURLProtocol.self]
  return RemoteClient(
    config: RemoteConfig(host: "100.64.0.9", port: 4173, token: "abc123"),
    session: URLSession(configuration: c))
}

private func json(_ value: Any) -> Data {
  try! JSONSerialization.data(withJSONObject: value)
}

private let sampleCatalog = RemoteCatalog(
  updatedAt: "2026-09-13T00:00:00.000Z",
  defaultAgentId: "codex-acp",
  projects: [
    RemoteCatalogProject(id: "p1", name: "FolkLore", path: "/Users/me/code/FolkLore"),
    RemoteCatalogProject(id: "p2", name: "Folk Tales", path: "/Users/me/code/folk-tales"),
    RemoteCatalogProject(id: "p3", name: "Pipper", path: "/Users/me/code/omni"),
  ],
  agents: [
    RemoteCatalogAgent(id: "codex-acp", displayName: "Codex", available: true),
    RemoteCatalogAgent(id: "claude-acp", displayName: "Claude Code", available: true),
    RemoteCatalogAgent(id: "opencode-acp", displayName: "opencode", available: false),
  ])

@Suite("Pairing URL")
struct PairingURLTests {
  @Test func parsesLaptopQr() {
    let cfg = PairingURL.parse("http://100.101.102.103:4173/remote#token=deadBEEF42")
    #expect(cfg == RemoteConfig(host: "100.101.102.103", port: 4173, token: "deadBEEF42"))
  }

  @Test func defaultsPortWhenOmitted() {
    #expect(PairingURL.parse("http://100.1.2.3/remote#token=x1")?.port == 4173)
  }

  @Test func rejectsForeignUrls() {
    #expect(PairingURL.parse("https://example.com/#token=abc") == nil)
    #expect(PairingURL.parse("http://100.1.2.3:4173/remote") == nil)
    #expect(PairingURL.parse("not a url") == nil)
  }

  @Test func hostInputTolerance() {
    #expect(PairingURL.parseHostInput("100.82.38.10")! == ("100.82.38.10", nil, nil))
    #expect(PairingURL.parseHostInput(" 100.82.38.10:4173 ")! == ("100.82.38.10", 4173, nil))
    #expect(PairingURL.parseHostInput("http://100.82.38.10:4173/remote#token=abc")! == ("100.82.38.10", 4173, "abc"))
    #expect(PairingURL.parseHostInput("http://100.82.38.10:4173/remote")! == ("100.82.38.10", 4173, nil))
    #expect(PairingURL.parseHostInput("100.82.38.10:notaport") == nil)
    #expect(PairingURL.parseHostInput("") == nil)
  }

  @Test func bareTokenDetection() {
    #expect(PairingURL.isBareToken(" a1b2c3 "))
    #expect(!PairingURL.isBareToken("http://x"))
    #expect(!PairingURL.isBareToken(""))
  }
}

@Suite("Catalog")
struct CatalogTests {
  @Test func decodesLaptopShape() throws {
    // Exactly what electron/siri/siri-catalog.ts writes.
    let text = """
      {"version":1,"updatedAt":"2026-09-13T01:02:03.000Z","defaultAgentId":"cursor-acp",
       "projects":[{"id":"bae0366a","name":"FolkLore-LiveLore-","path":"/Users/me/code/FolkLore-LiveLore-"}],
       "agents":[{"id":"opencode-acp","displayName":"opencode","available":true}]}
      """
    let catalog = try JSONDecoder().decode(RemoteCatalog.self, from: Data(text.utf8))
    #expect(catalog.projects.first?.name == "FolkLore-LiveLore-")
    #expect(catalog.agents.first?.available == true)
  }

  @Test func spokenNameRanking() {
    let hits = sampleCatalog.projects(matching: "folk")
    #expect(hits.map(\.id) == ["p1", "p2"])
    #expect(sampleCatalog.projects(matching: "FOLKLORE").map(\.id) == ["p1"])
    #expect(sampleCatalog.projects(matching: "").count == 3)
    #expect(sampleCatalog.projects(matching: "zzz").isEmpty)
  }

  @Test func agentMatchingSkipsUnavailable() {
    #expect(sampleCatalog.agents(matching: "open").isEmpty)
    #expect(sampleCatalog.agents(matching: "claude").map(\.id) == ["claude-acp"])
  }

  @Test func preferredAgentFallsBackWhenDefaultUnavailable() {
    var c = sampleCatalog
    c.defaultAgentId = "opencode-acp"
    #expect(c.preferredAgent?.id == "codex-acp")
    c.defaultAgentId = "claude-acp"
    #expect(c.preferredAgent?.id == "claude-acp")
  }

  @Test func storeRoundTrip() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(
      "pipper-remote-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let store = CatalogStore(fileURL: dir.appendingPathComponent("siri-catalog.json"))
    #expect(store.load() == nil)
    try store.save(sampleCatalog)
    #expect(store.load() == sampleCatalog)
    #expect(store.modifiedAt != nil)
    store.clear()
    #expect(store.load() == nil)
  }
}

@Suite("Remote client", .serialized)
struct RemoteClientTests {
  @Test func sendsBearerAndParsesCatalog() async throws {
    let client = stubClient { req in
      #expect(req.url?.path == "/api/remote/catalog")
      #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer abc123")
      return (200, try! JSONEncoder().encode(sampleCatalog))
    }
    let catalog = try await client.fetchCatalog()
    #expect(catalog == sampleCatalog)
    #expect(StubURLProtocol.lastRequest?.url?.host == "100.64.0.9")
    #expect(StubURLProtocol.lastRequest?.url?.port == 4173)
  }

  @Test func createThreadPostsAgentAsModelId() async throws {
    let client = stubClient { req in
      #expect(req.httpMethod == "POST")
      return (
        201,
        json([
          "thread": [
            "id": "t1", "projectId": "p1", "worktreePath": "/tmp/wt", "title": "Fix login",
            "running": true, "lastUsedAt": 1_700_000_000_000,
          ]
        ])
      )
    }
    let thread = try await client.createThread(projectId: "p1", agentId: "codex-acp", prompt: "Fix login")
    #expect(thread.id == "t1")
    #expect(thread.running)
    let body = try JSONSerialization.jsonObject(with: StubURLProtocol.lastBody ?? Data()) as? [String: Any]
    #expect(body?["projectId"] as? String == "p1")
    #expect(body?["modelId"] as? String == "codex-acp")
    #expect(body?["prompt"] as? String == "Fix login")
  }

  @Test func unauthorizedSurfacesPairingError() async {
    let client = stubClient { _ in (401, json(["error": "Unauthorized"])) }
    do {
      _ = try await client.listThreads()
      Issue.record("expected throw")
    } catch let error as RemoteClientError {
      #expect(error == .http(status: 401, body: "Unauthorized"))
      #expect(error.errorDescription?.contains("Pair again") == true)
    } catch {
      Issue.record("unexpected \(error)")
    }
  }

  @Test func unpairedConfigNeverHitsNetwork() async {
    let client = RemoteClient(config: RemoteConfig(host: "", token: ""))
    do {
      _ = try await client.health()
      Issue.record("expected throw")
    } catch let error as RemoteClientError {
      #expect(error == .notPaired)
    } catch {
      Issue.record("unexpected \(error)")
    }
  }

  @Test func reportDecodes() async throws {
    let client = stubClient { _ in
      (
        200,
        json([
          "report": [
            "threadId": "t1", "running": false, "summary": "Fix login", "finalText": "Done.",
            "messages": [["role": "user", "text": "Fix login"], ["role": "agent", "text": "Done."]],
            "projectName": "FolkLore", "filesTouched": ["src/a.ts"], "worktreePath": NSNull(),
            "isolated": false, "isolationNote": "no commits yet",
          ]
        ])
      )
    }
    let r = try await client.report(threadId: "t1")
    #expect(r.messages.count == 2)
    #expect(r.messages[1].role == .agent)
    #expect(r.isolated == false)
    #expect(r.worktreePath == nil)
  }
}
