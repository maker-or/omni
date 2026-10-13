import CryptoKit
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

private let laptopBase = URL(string: "https://lt-ab12cd.pipper.dev")!

private func stubSession(_ handler: @escaping (URLRequest) -> (Int, Data)) -> URLSession {
  StubURLProtocol.handler = handler
  let c = URLSessionConfiguration.ephemeral
  c.protocolClasses = [StubURLProtocol.self]
  return URLSession(configuration: c)
}

private func stubClient(
  onUnauthorized: (@Sendable () -> Void)? = nil, _ handler: @escaping (URLRequest) -> (Int, Data)
) -> RemoteClient {
  RemoteClient(
    config: RemoteConfig(baseURL: laptopBase, token: "abc123"),
    session: stubSession(handler), onUnauthorized: onUnauthorized)
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

@Suite("Pairing link")
struct PairingLinkTests {
  @Test func parsesHostedAppLinkForANamedTunnel() throws {
    let link = try #require(
      PairingLink.parse("https://remote.pipper.dev/#pair=7KD2MQX9HT&host=LT-ab12cd.pipper.dev"))
    #expect(link.code == "7KD2MQX9HT")
    // The laptop is the `host` parameter, never the page that carried it.
    #expect(link.baseURL == URL(string: "https://lt-ab12cd.pipper.dev"))
    #expect(link.isNamedTunnel)
  }

  @Test func parsesLaptopServedLinks() throws {
    let quick = try #require(PairingLink.parse("https://calm-fox.trycloudflare.com/remote#pair=ABCDE-12345"))
    #expect(quick.baseURL == URL(string: "https://calm-fox.trycloudflare.com"))
    #expect(!quick.isNamedTunnel)
    let tailnet = try #require(PairingLink.parse("http://100.101.102.103:4173/remote#pair=ABCDE12345"))
    #expect(tailnet.baseURL == URL(string: "http://100.101.102.103:4173"))
  }

  @Test func neverPointsTheAppAtAForeignHost() {
    for text in [
      "https://remote.pipper.dev/#pair=ABCDE&host=evil.example.com",
      "https://remote.pipper.dev/#pair=ABCDE&host=www.pipper.dev",
      "https://remote.pipper.dev/#pair=ABCDE&host=lt-x.pipper.dev.evil.com",
      "https://example.com/remote#pair=ABCDE",
      "http://192.168.1.4:4173/remote#pair=ABCDE",
      "http://lt-ab12cd.pipper.dev/remote#pair=ABCDE",
      "http://100.1.2.3:4173/remote#token=deadbeef",
      "https://lt-ab12cd.pipper.dev/#pair=bad%20code",
      "not a url",
    ] {
      #expect(PairingLink.parse(text) == nil, "\(text)")
    }
  }

  @Test func manualEntryAcceptsAddressesOrAWholeLink() {
    #expect(
      PairingLink.manual(address: "lt-ab12cd.pipper.dev", code: " ABCDE-12345 ")?.baseURL
        == URL(string: "https://lt-ab12cd.pipper.dev"))
    #expect(
      PairingLink.manual(address: "100.82.38.10", code: "ABCDE")?.baseURL
        == URL(string: "http://100.82.38.10:4173"))
    #expect(
      PairingLink.manual(address: "100.82.38.10:5000", code: "ABCDE")?.baseURL
        == URL(string: "http://100.82.38.10:5000"))
    let pasted = PairingLink.manual(
      address: "https://remote.pipper.dev/#pair=FROMLINK&host=lt-ab12cd.pipper.dev", code: "")
    #expect(pasted?.code == "FROMLINK")
    #expect(PairingLink.manual(address: "example.com", code: "ABCDE") == nil)
    #expect(PairingLink.manual(address: "lt-ab12cd.pipper.dev", code: "") == nil)
  }
}

@Suite("Laptop owner statement")
struct LaptopAttestationTests {
  private static func base64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }

  /// Signs like pipper.dev: `pa1.<b64url JSON>.<b64url Ed25519 sig>`.
  private static func sign(_ claims: [String: Any], key: Curve25519.Signing.PrivateKey) throws -> String {
    let body = "pa1.\(base64URL(try JSONSerialization.data(withJSONObject: claims)))"
    return "\(body).\(base64URL(try key.signature(for: Data(body.utf8))))"
  }

  private let key = Curve25519.Signing.PrivateKey()
  private var publicKey: String { Self.base64URL(key.publicKey.rawRepresentation) }
  private let now = Date(timeIntervalSince1970: 1_800_000_000)
  private var claims: [String: Any] {
    ["host": "lt-ab12cd.pipper.dev", "sub": "user_1", "email": "me@example.com", "name": "Me",
     "exp": (now.timeIntervalSince1970 + 3600) * 1000]
  }

  @Test func verifiesTheOwnerForThisExactHost() throws {
    let statement = try Self.sign(claims, key: key)
    let check = LaptopAttestation.verify(
      statement, host: "LT-ab12cd.pipper.dev", publicKey: publicKey, now: now)
    #expect(check == .verified(LaptopOwner(sub: "user_1", email: "me@example.com", name: "Me")))
  }

  @Test func refusesForgedMovedOrExpiredStatements() throws {
    let statement = try Self.sign(claims, key: key)
    let forged = try Self.sign(claims, key: Curve25519.Signing.PrivateKey())
    var expired = claims
    expired["exp"] = (now.timeIntervalSince1970 - 1) * 1000
    for (text, host) in [
      (forged, "lt-ab12cd.pipper.dev"),
      (statement, "lt-other.pipper.dev"),
      (try Self.sign(expired, key: key), "lt-ab12cd.pipper.dev"),
      ("pa1.garbage", "lt-ab12cd.pipper.dev"),
    ] {
      guard case .unverified = LaptopAttestation.verify(text, host: host, publicKey: publicKey, now: now)
      else { Issue.record("accepted \(text) for \(host)"); continue }
    }
    #expect(LaptopAttestation.verify(nil, host: "lt-ab12cd.pipper.dev") != .verified(
      LaptopOwner(sub: "user_1", email: nil, name: nil)))
  }

  @Test func shipsAUsablePublicKey() {
    #expect(LaptopAttestation.base64URLDecode(LaptopAttestation.pipperPublicKey)?.count == 32)
  }
}

/// Pairing calls share the URLProtocol stub, so they run in the serialized
/// "Remote client" suite.
extension RemoteClientTests {
  private var link: PairingLink { PairingLink(code: "ABCDE12345", baseURL: laptopBase)! }

  @Test func previewSendsOnlyTheCodeAndNoCredential() async throws {
    let session = stubSession { request in
      #expect(request.url?.absoluteString == "https://lt-ab12cd.pipper.dev/api/remote/pair/preview")
      #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
      return (200, json(["laptop": ["name": "Studio", "host": "lt-ab12cd.pipper.dev", "attestation": NSNull()]]))
    }
    let laptop = try await RemoteClient.previewPairing(link, session: session)
    #expect(laptop == RemoteLaptopIdentity(name: "Studio", host: "lt-ab12cd.pipper.dev", attestation: nil))
    let body = try JSONSerialization.jsonObject(with: StubURLProtocol.lastBody!) as! [String: Any]
    #expect(body as NSDictionary == ["code": "ABCDE12345"])
  }

  @Test func redeemReturnsThisPhonesOwnToken() async throws {
    let session = stubSession { request in
      #expect(request.url?.path == "/api/remote/pair")
      return (201, json([
        "token": "device-token",
        "device": ["id": "d1", "name": "iPhone · Pipper", "scopes": ["read", "run"], "createdAt": 1, "lastSeenAt": NSNull()],
        "laptop": ["name": "Studio", "host": "lt-ab12cd.pipper.dev", "attestation": NSNull()],
      ]))
    }
    let paired = try await RemoteClient.redeemPairing(link, deviceName: "iPhone · Pipper", session: session)
    #expect(paired.token == "device-token")
    #expect(paired.device.canRun)
    let body = try JSONSerialization.jsonObject(with: StubURLProtocol.lastBody!) as! [String: Any]
    #expect(body["deviceName"] as? String == "iPhone · Pipper")
  }

  @Test func wrongOrExpiredCodeReadsAsSuch() async {
    let session = stubSession { _ in (401, json(["error": "Invalid or expired pairing code"])) }
    do {
      _ = try await RemoteClient.redeemPairing(link, deviceName: "iPhone", session: session)
      Issue.record("expected throw")
    } catch let error as RemoteClientError {
      #expect(error.errorDescription?.contains("expired") == true)
    } catch { Issue.record("unexpected \(error)") }
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
    #expect(StubURLProtocol.lastRequest?.url?.host == "lt-ab12cd.pipper.dev")
    #expect(StubURLProtocol.lastRequest?.url?.scheme == "https")
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
    let thread = try await client.createThread(projectId: "p1", agentId: "codex-acp", prompt: "Fix login", requestId: "create-1")
    #expect(thread.id == "t1")
    #expect(thread.running)
    let body = try JSONSerialization.jsonObject(with: StubURLProtocol.lastBody ?? Data()) as? [String: Any]
    #expect(body?["requestId"] as? String == "create-1")
    #expect(body?["projectId"] as? String == "p1")
    #expect(body?["modelId"] as? String == "codex-acp")
    #expect(body?["prompt"] as? String == "Fix login")
  }

  @Test func modelChoiceTravelsSeparatelyFromAgent() async throws {
    let client = stubClient { _ in
      (201, json(["thread": ["id": "t1", "projectId": "p1", "running": true, "lastUsedAt": 0]]))
    }
    _ = try await client.createThread(projectId: "p1", agentId: "codex-acp", prompt: "Fix", requestId: "r1")
    var body = try JSONSerialization.jsonObject(with: StubURLProtocol.lastBody ?? Data()) as? [String: Any]
    #expect(body?["model"] == nil)
    _ = try await client.createThread(
      projectId: "p1", agentId: "codex-acp", model: "gpt-5", prompt: "Fix", requestId: "r2")
    body = try JSONSerialization.jsonObject(with: StubURLProtocol.lastBody ?? Data()) as? [String: Any]
    #expect(body?["modelId"] as? String == "codex-acp")
    #expect(body?["model"] as? String == "gpt-5")
  }

  @Test func listsAndSwitchesModels() async throws {
    let client = stubClient { req in
      if req.httpMethod == "GET" {
        return (200, json(["models": ["codex-acp": [["id": "gpt-5", "name": "GPT-5"]]]]))
      }
      return (200, json(["model": ["current": "o3", "options": [["id": "gpt-5", "name": "GPT-5"], ["id": "o3", "name": "o3"]]]]))
    }
    let models = try await client.agentModels()
    #expect(StubURLProtocol.lastRequest?.url?.path == "/api/remote/agent-models")
    #expect(models["codex-acp"]?.first?.name == "GPT-5")
    let updated = try await client.setModel(threadId: "t1", model: "o3")
    #expect(StubURLProtocol.lastRequest?.url?.path == "/api/remote/threads/t1/model")
    #expect(updated?.currentName == "o3")
  }

  @Test func unauthorizedSurfacesPairingError() async {
    let revoked = UnauthorizedFlag()
    let client = stubClient(onUnauthorized: { revoked.set() }) { _ in
      (401, json(["error": "Unauthorized"]))
    }
    do {
      _ = try await client.listThreads()
      Issue.record("expected throw")
    } catch let error as RemoteClientError {
      #expect(error == .http(status: 401, body: "Unauthorized"))
      #expect(error.errorDescription?.contains("Pair again") == true)
      #expect(revoked.value)
    } catch {
      Issue.record("unexpected \(error)")
    }
  }

  @Test func unpairedConfigNeverHitsNetwork() async {
    let client = RemoteClient(config: RemoteConfig(baseURL: laptopBase, token: ""))
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
    // Older Macs omit `model`.
    #expect(r.model == nil)
  }
  @Test func followupCarriesStableRequestIdAndAcceptsImmediateAcknowledgement() async throws {
    let client = stubClient { request in
      #expect(request.url?.path == "/api/remote/threads/t1/prompt")
      return (202, json(["ok": true]))
    }
    try await client.sendPrompt(threadId: "t1", prompt: "Continue", requestId: "retry-1")
    let body = try JSONSerialization.jsonObject(with: StubURLProtocol.lastBody!) as! [String: Any]
    #expect(body["requestId"] as? String == "retry-1")
  }

  @Test func confirmedRejectionIsDistinctFromUncertainDelivery() async {
    let client = stubClient { _ in (409, json(["error": "No isolated workspace", "retryable": true])) }
    do {
      _ = try await client.createThread(projectId: "p1", agentId: "codex", prompt: "Fix login", requestId: "r1")
      Issue.record("expected rejection")
    } catch let error as RemoteClientError {
      #expect(error == .rejected("No isolated workspace"))
    } catch { Issue.record("unexpected \(error)") }
  }

  @Test func controlsTargetOnlyTheChosenThreadAndDecision() async throws {
    let client = stubClient { request in
      #expect(request.httpMethod == "POST")
      #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer abc123")
      return (200, json(["ok": true]))
    }
    try await client.stop(threadId: "phone-thread")
    #expect(StubURLProtocol.lastRequest?.url?.path == "/api/remote/threads/phone-thread/stop")
    try await client.answer(threadId: "phone-thread", decisionId: "decision-1", optionId: "reject")
    #expect(StubURLProtocol.lastRequest?.url?.path == "/api/remote/threads/phone-thread/permission")
    let body = try JSONSerialization.jsonObject(with: StubURLProtocol.lastBody!) as! [String: Any]
    #expect(body["decisionId"] as? String == "decision-1")
    #expect(body["optionId"] as? String == "reject")
    #expect(body["cancelled"] as? Bool == false)
  }

  @Test func diagnosticsChecksPairingAndAgentReadiness() async throws {
    let client = stubClient { request in
      #expect(request.url?.path == "/api/remote/diagnostics")
      return (200, json(["paired": true, "agentReady": true, "availableAgents": 0, "projects": 1]))
    }
    let checks = try await client.diagnostics()
    #expect(!checks.ready)
    #expect(checks.guidance.contains("Install"))
  }

  @Test func decodesPendingDecisionsAndFailedDelivery() async throws {
    let client = stubClient { _ in
      (200, json(["report": ["threadId": "t1", "running": false, "messages": [], "filesTouched": [], "isolated": true,
        "permissions": [["id": "d1", "title": "Run tests?", "options": [["optionId": "a", "name": "Allow once", "kind": "allow_once"]]]],
        "request": ["id": "r1", "threadId": "t1", "state": "failed", "error": "Agent disconnected", "updatedAt": 1]]]))
    }
    let report = try await client.report(threadId: "t1")
    #expect(report.permissions?.first?.options.first?.optionId == "a")
    #expect(report.request?.error == "Agent disconnected")
  }

}


final class UnauthorizedFlag: @unchecked Sendable {
  private let lock = NSLock()
  private var flag = false
  func set() { lock.withLock { flag = true } }
  var value: Bool { lock.withLock { flag } }
}

@Suite("Durable submission identities")
@MainActor
struct SubmissionStoreTests {
  @Test func uncertainRequestSurvivesRestartAndAcknowledgementAllowsNewTask() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = directory.appendingPathComponent("pending.json")
    let scope = ["mac", "4173", "create", "project", "agent", "private task"]
    let first = try RemoteSubmissionStore(fileURL: file).requestId(for: scope)
    let restored = RemoteSubmissionStore(fileURL: file)
    #expect(try restored.requestId(for: scope) == first)
    #expect(try restored.requestId(for: ["other Mac"] + scope) != first)
    #expect(try !String(contentsOf: file, encoding: .utf8).contains("private task"))
    try restored.acknowledge(scope, requestId: "stale-id")
    #expect(try restored.requestId(for: scope) == first)
    try restored.acknowledge(scope, requestId: first)
    #expect(try restored.requestId(for: scope) != first)
  }
}

@Suite("Thread intents")
struct ThreadIntentTests {
  private func thread(_ id: String, _ title: String?, project: String = "p1", at: Double) -> RemoteThreadSummary {
    RemoteThreadSummary(id: id, projectId: project, worktreePath: nil, title: title, running: false, lastUsedAt: at)
  }

  private func report(
    running: Bool = false, messages: [RemoteMessage] = [], files: [String] = [],
    permissions: [RemotePermission]? = nil, request: RemoteRequestStatus? = nil
  ) -> RemoteReport {
    RemoteReport(
      threadId: "t1", running: running, summary: "Fix login", finalText: nil, messages: messages,
      projectName: "FolkLore", filesTouched: files, worktreePath: nil, isolated: true, isolationNote: nil,
      permissions: permissions, request: request, model: nil)
  }

  @Test func threadsSortRecentFirstAndMatchTitleThenProject() {
    let threads = [
      thread("old", "Fix login bug", at: 1),
      thread("new", "Add dark mode", at: 3),
      thread("mid", nil, project: "p2", at: 2),
    ]
    #expect(RemoteThreadSummary.recentFirst(threads).map(\.id) == ["new", "mid", "old"])
    let names = ["p1": "FolkLore", "p2": "Login Service"]
    // Title match beats a project-name match, which still appears after it.
    #expect(RemoteThreadSummary.matching("login", in: threads, projectName: { names[$0] }).map(\.id) == ["old", "mid"])
    #expect(RemoteThreadSummary.matching("", in: threads, projectName: { names[$0] }).map(\.id) == ["new", "mid", "old"])
    #expect(threads[2].displayTitle == "Untitled thread")
  }

  @Test func statusPrefersPendingDecisionThenProgressThenFailure() {
    let decision = RemotePermission(id: "d1", title: "Delete **old** file?", detail: nil, options: [])
    #expect(
      report(running: true, permissions: [decision]).spokenStatus()
        == "It's waiting for you: Delete old file? Open Pipper to answer.")

    let failed = RemoteRequestStatus(id: "r1", threadId: "t1", state: "failed", error: "No worktree", updatedAt: 0)
    #expect(report(request: failed).spokenStatus() == "The last request failed. No worktree.")
    // A newer turn started on the Mac outranks the old remote failure.
    #expect(report(running: true, request: failed).spokenStatus() == "It's still working.")

    #expect(report(running: true).spokenStatus() == "It's still working.")
    let working = report(running: true, messages: [RemoteMessage(role: .agent, text: "Reading `App.tsx`")])
    #expect(working.spokenStatus() == "It's still working. Latest: Reading App.tsx.")

    let done = report(
      messages: [
        RemoteMessage(role: .agent, text: "Earlier reply"),
        RemoteMessage(role: .user, text: "Now add tests"),
        RemoteMessage(role: .agent, text: "## Done\n\nAdded tests.\n\n```swift\nfunc x() {}\n```\n| a | b |"),
      ], files: ["a.swift", "b.swift"])
    #expect(done.spokenStatus() == "It's finished. Changed 2 files. Done. Added tests.")
  }

  @Test func spokenTextStripsMarkdownAndTruncatesAtSentenceOrWord() {
    #expect(SpokenText.plain("- See [the docs](https://x.dev) for **more**", limit: 200) == "See the docs for more.")
    let long = "First sentence is here. Second sentence runs on and on and on"
    #expect(SpokenText.plain(long, limit: 40) == "First sentence is here.")
    #expect(SpokenText.truncate("one two three four five", limit: 12) == "one two…")
  }
}

// Own stub so these tests can't race the Remote client suite's shared handler.
final class CloudStubURLProtocol: URLProtocol {
  nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, Data))?

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    var request = request
    if request.httpBody == nil, let stream = request.httpBodyStream {
      stream.open()
      var data = Data()
      var buffer = [UInt8](repeating: 0, count: 4096)
      while stream.hasBytesAvailable {
        let n = stream.read(&buffer, maxLength: buffer.count)
        if n <= 0 { break }
        data.append(buffer, count: n)
      }
      stream.close()
      request.httpBody = data
    }
    let (status, body) = CloudStubURLProtocol.handler?(request) ?? (500, Data())
    let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: body)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

@Suite("Pipper cloud (GitHub)", .serialized)
struct PipperCloudTests {
  private func client(token: String? = "clerk-jwt", _ handler: @escaping (URLRequest) -> (Int, Data))
    -> PipperCloudClient
  {
    CloudStubURLProtocol.handler = handler
    let c = URLSessionConfiguration.ephemeral
    c.protocolClasses = [CloudStubURLProtocol.self]
    return PipperCloudClient(
      baseURL: URL(string: "https://www.pipper.dev")!, session: URLSession(configuration: c),
      tokenProvider: { token })
  }

  @Test func reposSendTheClerkTokenAndDecode() async throws {
    var seen: URLRequest?
    let repos = try await client { req in
      seen = req
      return (200, json(["repos": [["id": 1, "owner": "maker-or", "name": "omni", "fullName": "maker-or/omni", "isPrivate": true]]]))
    }.repos()
    #expect(repos.map(\.fullName) == ["maker-or/omni"])
    #expect(seen?.url?.absoluteString == "https://www.pipper.dev/api/github/repos.json")
    #expect(seen?.value(forHTTPHeaderField: "Authorization") == "Bearer clerk-jwt")
  }

  @Test func createIssueSendsOnlyTheIssueFields() async throws {
    var sent: [String: Any] = [:]
    let issue = try await client { req in
      sent = (try? JSONSerialization.jsonObject(with: req.httpBody ?? Data())) as? [String: Any] ?? [:]
      return (201, json(["issue": ["number": 7, "title": "Crash", "repository": "a/b", "url": "https://github.com/a/b/issues/7"]]))
    }.createIssue(owner: "a", repo: "b", title: "Crash", body: nil)
    #expect(issue.number == 7)
    #expect(sent["owner"] as? String == "a")
    #expect(sent["title"] as? String == "Crash")
    #expect(sent["body"] == nil)
  }

  @Test func pullRequestsDecodeStatus() async throws {
    let prs = try await client { _ in
      (200, json(["pullRequests": [[
        "number": 41, "title": "Add intents", "author": "harshith", "description": "", "status": "draft",
        "repository": "maker-or/omni", "url": "https://github.com/maker-or/omni/pull/41",
      ]]]))
    }.pullRequests()
    #expect(prs.first?.status == .draft)
  }

  @Test func signedOutNeverHitsTheNetworkAndServerErrorsReadAsMessages() async {
    var called = false
    await #expect(throws: PipperCloudError.signedOut) {
      try await client(token: nil) { _ in called = true; return (200, Data()) }.repos()
    }
    #expect(!called)
    await #expect(throws: PipperCloudError.server(status: 409, message: "Sign in to Pipper with GitHub to use GitHub actions.")) {
      try await client { _ in (409, json(["error": "Sign in to Pipper with GitHub to use GitHub actions."])) }.repos()
    }
    await #expect(throws: PipperCloudError.signedOut) {
      try await client { _ in (401, json(["error": "Sign in to Pipper again."])) }.pullRequests()
    }
  }

  @Test func repoMatchingByNameOrFullName() {
    let repos = [
      GitHubRepo(id: 1, owner: "maker-or", name: "omni", fullName: "maker-or/omni", isPrivate: false),
      GitHubRepo(id: 2, owner: "harshith", name: "omni", fullName: "harshith/omni", isPrivate: false),
      GitHubRepo(id: 3, owner: "maker-or", name: "omni-docs", fullName: "maker-or/omni-docs", isPrivate: false),
    ]
    #expect(GitHubRepo.matching("Omni", in: repos).map(\.id) == [1, 2, 3])
    #expect(GitHubRepo.matching("maker-or/omni", in: repos).map(\.id) == [1, 3])
    #expect(GitHubRepo.matching("docs", in: repos).map(\.id) == [3])
  }

  @Test func repoStoreRoundTrip() throws {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("repos-\(UUID().uuidString).json")
    let store = GitHubRepoStore(fileURL: file)
    defer { store.clear() }
    #expect(store.load() == nil)
    let repos = [GitHubRepo(id: 1, owner: "a", name: "b", fullName: "a/b", isPrivate: true)]
    try store.save(repos)
    #expect(store.load() == repos)
  }
}
