import Foundation
import CryptoKit

public enum RemoteClientError: Error, LocalizedError, Equatable {
  case notPaired
  case badURL
  case unreachable(String)
  case http(status: Int, body: String)
  case decoding(String)
  case rejected(String)

  public var errorDescription: String? {
    switch self {
    case .notPaired: return "Not paired with a Mac yet."
    case .badURL: return "The Mac address is invalid."
    case .unreachable(let why):
      return "Couldn't reach your Mac (\(why)). Keep Pipper open on your Mac and check your connection."
    case .http(let status, let body):
      if status == 401 { return "Your Mac no longer accepts this phone. Pair again." }
      if status == 429 { return "Too many attempts. Wait a minute and try again." }
      if status == 503 { return "The agent on your Mac isn't ready yet." }
      // 403 explains itself (e.g. a read-only phone starting work).
      if status == 403, !body.isEmpty { return body }
      let detail = body.trimmingCharacters(in: .whitespacesAndNewlines)
      return detail.isEmpty ? "Mac returned HTTP \(status)." : "Mac returned HTTP \(status): \(detail)"
    case .rejected(let message): return message
    case .decoding(let why): return "Unexpected reply from the Mac (\(why))."
    }
  }
}

/// Thin async client for the laptop's `/api/remote/*` routes. This phone's
/// device token on every call; short timeouts because Siri waits on `perform()`.
public struct RemoteClient: Sendable {
  public let config: RemoteConfig
  private let session: URLSession
  /// Called when the laptop refuses this phone's token (revoked or expired).
  private let onUnauthorized: (@Sendable () -> Void)?

  public init(
    config: RemoteConfig, session: URLSession? = nil,
    onUnauthorized: (@Sendable () -> Void)? = nil
  ) {
    self.config = config
    self.session = session ?? Self.defaultSession()
    self.onUnauthorized = onUnauthorized
  }

  static func defaultSession() -> URLSession {
    let c = URLSessionConfiguration.ephemeral
    c.timeoutIntervalForRequest = 15
    c.timeoutIntervalForResource = 30
    c.waitsForConnectivity = false
    return URLSession(configuration: c)
  }

  // MARK: Routes

  public func health() async throws -> Bool {
    struct Health: Decodable { var ok: Bool }
    let h: Health = try await get("/api/remote/health")
    return h.ok
  }

  /// The laptop's view of this phone (name and scopes).
  public func device() async throws -> RemoteDevice {
    struct Body: Decodable { var device: RemoteDevice }
    let b: Body = try await get("/api/remote/session")
    return b.device
  }

  /// Unpair on the laptop too, so the token is dead even if it leaked.
  public func revokeThisDevice() async throws {
    struct Body: Decodable { var ok: Bool }
    let _: Body = try await perform(request("/api/remote/session", method: "DELETE", body: nil))
  }

  public func diagnostics() async throws -> RemoteDiagnostics {
    try await get("/api/remote/diagnostics")
  }

  public func stop(threadId: String) async throws {
    struct Input: Encodable {}
    struct Body: Decodable { var ok: Bool }
    let _: Body = try await post("/api/remote/threads/\(encode(threadId))/stop", Input())
  }

  public func answer(threadId: String, decisionId: String, optionId: String?, cancelled: Bool = false) async throws {
    struct Input: Encodable { var decisionId: String; var optionId: String?; var cancelled: Bool }
    struct Body: Decodable { var ok: Bool }
    let _: Body = try await post("/api/remote/threads/\(encode(threadId))/permission",
      Input(decisionId: decisionId, optionId: optionId, cancelled: cancelled))
  }

  public func fetchCatalog() async throws -> RemoteCatalog {
    try await get("/api/remote/catalog")
  }

  public func listThreads() async throws -> [RemoteThreadSummary] {
    struct Body: Decodable { var threads: [RemoteThreadSummary] }
    let b: Body = try await get("/api/remote/threads")
    return b.threads
  }

  public func report(threadId: String) async throws -> RemoteReport {
    struct Body: Decodable { var report: RemoteReport }
    let b: Body = try await get("/api/remote/threads/\(encode(threadId))/report")
    return b.report
  }

  /// Models inside each agent, keyed by agent instance id. The Mac may spawn
  /// agents to answer, so this gets a longer timeout than other routes.
  public func agentModels() async throws -> [String: [RemoteAgentModel]] {
    struct Body: Decodable { var models: [String: [RemoteAgentModel]] }
    var req = try request("/api/remote/agent-models", method: "GET", body: nil)
    req.timeoutInterval = 30
    let b: Body = try await perform(req)
    return b.models
  }

  /// `agentId` maps to the laptop's `modelId` field (it is an agent id there);
  /// `model` is the model inside that agent, nil for the agent's default.
  public func createThread(
    projectId: String, agentId: String?, model: String? = nil, prompt: String, requestId: String
  ) async throws -> RemoteThreadSummary {
    struct Input: Encodable {
      var requestId: String
      var projectId: String
      var modelId: String?
      var model: String?
      var prompt: String
    }
    struct Body: Decodable { var thread: RemoteThreadSummary }
    let b: Body = try await post(
      "/api/remote/threads",
      Input(requestId: requestId, projectId: projectId, modelId: agentId, model: model, prompt: prompt))
    return b.thread
  }

  /// Switches the model for the thread's next turn.
  public func setModel(threadId: String, model: String) async throws -> RemoteThreadModel? {
    struct Input: Encodable { var model: String }
    struct Body: Decodable { var model: RemoteThreadModel? }
    let b: Body = try await post("/api/remote/threads/\(encode(threadId))/model", Input(model: model))
    return b.model
  }

  public func sendPrompt(threadId: String, prompt: String, requestId: String) async throws {
    struct Input: Encodable { var requestId: String; var prompt: String }
    struct Body: Decodable { var ok: Bool }
    let _: Body = try await post("/api/remote/threads/\(encode(threadId))/prompt", Input(requestId: requestId, prompt: prompt))
  }

  // MARK: Transport

  /// RFC 3986 unreserved characters pass through untouched. The Mac matches
  /// the raw `url.pathname` without decoding, so escaping the `-` in a UUID
  /// (as `.alphanumerics` alone would, to `%2D`) makes every thread 404.
  private static let pathSegmentAllowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))

  private func encode(_ segment: String) -> String {
    segment.addingPercentEncoding(withAllowedCharacters: Self.pathSegmentAllowed) ?? segment
  }

  private func request(_ path: String, method: String, body: Data?) throws -> URLRequest {
    guard config.isComplete else { throw RemoteClientError.notPaired }
    guard let url = URL(string: path, relativeTo: config.baseURL) else { throw RemoteClientError.badURL }
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    req.httpBody = body
    return req
  }

  private func get<T: Decodable>(_ path: String) async throws -> T {
    try await perform(request(path, method: "GET", body: nil))
  }

  private func post<T: Decodable, I: Encodable>(_ path: String, _ input: I) async throws -> T {
    let data = try JSONEncoder().encode(input)
    return try await perform(request(path, method: "POST", body: data))
  }

  private struct Rejection: Decodable { var error: String; var retryable: Bool? }

  // MARK: Pairing (no token yet)

  /// Ask the laptop who it is without using the code up, so the user can
  /// confirm before this phone sends it anything (pairing-link hijack defense).
  public static func previewPairing(
    _ link: PairingLink, session: URLSession? = nil
  ) async throws -> RemoteLaptopIdentity {
    struct Input: Encodable { var code: String }
    struct Body: Decodable { var laptop: RemoteLaptopIdentity }
    let b: Body = try await pairingCall(
      "/api/remote/pair/preview", link: link, input: Input(code: link.code), session: session)
    return b.laptop
  }

  /// Redeem the one-time code for this phone's own device token.
  public static func redeemPairing(
    _ link: PairingLink, deviceName: String, session: URLSession? = nil
  ) async throws -> RemotePairResponse {
    struct Input: Encodable { var code: String; var deviceName: String }
    return try await pairingCall(
      "/api/remote/pair", link: link, input: Input(code: link.code, deviceName: deviceName),
      session: session)
  }

  private static func pairingCall<T: Decodable, I: Encodable>(
    _ path: String, link: PairingLink, input: I, session: URLSession?
  ) async throws -> T {
    guard let url = URL(string: path, relativeTo: link.baseURL) else { throw RemoteClientError.badURL }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    req.httpBody = try JSONEncoder().encode(input)
    do {
      return try await send(req, session: session ?? defaultSession())
    } catch RemoteClientError.http(status: 401, _) {
      throw RemoteClientError.rejected("That code is wrong or has expired. Make a new one on your Mac.")
    } catch RemoteClientError.http(status: 404, _) {
      throw RemoteClientError.rejected(
        "That Mac's Pipper is too old for this app. Update Pipper on your Mac, then pair again.")
    }
  }

  private func perform<T: Decodable>(_ req: URLRequest) async throws -> T {
    do {
      return try await Self.send(req, session: session)
    } catch RemoteClientError.http(status: 401, let body) {
      onUnauthorized?()
      throw RemoteClientError.http(status: 401, body: body)
    }
  }

  static func send<T: Decodable>(_ req: URLRequest, session: URLSession) async throws -> T {
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: req)
    } catch {
      throw RemoteClientError.unreachable((error as NSError).localizedDescription)
    }
    guard let http = response as? HTTPURLResponse else {
      throw RemoteClientError.decoding("not an HTTP response")
    }
    guard (200..<300).contains(http.statusCode) else {
      let text = String(data: data.prefix(16_384), encoding: .utf8) ?? ""
      if let rejection = try? JSONDecoder().decode(Rejection.self, from: data), rejection.retryable == true {
        throw RemoteClientError.rejected(rejection.error)
      }
      throw RemoteClientError.http(status: http.statusCode, body: RemoteClient.errorMessage(from: text))
    }
    do {
      return try JSONDecoder().decode(T.self, from: data)
    } catch {
      throw RemoteClientError.decoding(String(describing: error))
    }
  }

  /// Server errors are `{ "error": "..." }`; surface the message, not JSON.
  static func errorMessage(from body: String) -> String {
    struct E: Decodable { var error: String }
    if let data = body.data(using: .utf8), let e = try? JSONDecoder().decode(E.self, from: data) {
      return e.error
    }
    return body
  }
}


/// Keeps the same ID after a timeout, app restart, or repeated Siri attempt.
/// Only hashes and UUIDs are stored. Clear after the Mac acknowledges acceptance.
@MainActor
public final class RemoteSubmissionStore {
  private let fileURL: URL

  public init(fileURL: URL? = nil) {
    self.fileURL = fileURL ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("remote-submissions.json")
  }

  public func requestId(for scope: [String]) throws -> String {
    var pending = try load()
    let key = try key(scope)
    if let id = pending[key] { return id }
    let id = UUID().uuidString
    pending[key] = id
    try save(pending)
    return id
  }

  public func acknowledge(_ scope: [String], requestId: String) throws {
    var pending = try load()
    let key = try key(scope)
    if pending[key] == requestId {
      pending.removeValue(forKey: key)
      try save(pending)
    }
  }

  private func key(_ scope: [String]) throws -> String {
    SHA256.hash(data: try JSONEncoder().encode(scope)).map { String(format: "%02x", $0) }.joined()
  }

  private func load() throws -> [String: String] {
    guard FileManager.default.fileExists(atPath: fileURL.path) else { return [:] }
    return try JSONDecoder().decode([String: String].self, from: Data(contentsOf: fileURL))
  }

  private func save(_ pending: [String: String]) throws {
    try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(pending).write(to: fileURL, options: .atomic)
  }
}
