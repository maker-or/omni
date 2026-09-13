import Foundation

public enum RemoteClientError: Error, LocalizedError, Equatable {
  case notPaired
  case badURL
  case unreachable(String)
  case http(status: Int, body: String)
  case decoding(String)

  public var errorDescription: String? {
    switch self {
    case .notPaired: return "Not paired with a Mac yet."
    case .badURL: return "The Mac address is invalid."
    case .unreachable(let why): return "Couldn't reach your Mac (\(why)). Is Tailscale connected?"
    case .http(let status, let body):
      if status == 401 { return "The Mac rejected the pairing token. Pair again." }
      if status == 503 { return "The agent on your Mac isn't ready yet." }
      let detail = body.trimmingCharacters(in: .whitespacesAndNewlines)
      return detail.isEmpty ? "Mac returned HTTP \(status)." : "Mac returned HTTP \(status): \(detail)"
    case .decoding(let why): return "Unexpected reply from the Mac (\(why))."
    }
  }
}

/// Thin async client for the laptop's `/api/remote/*` routes. Bearer token on
/// every call; short timeouts because Siri waits on `perform()`.
public struct RemoteClient: Sendable {
  public let config: RemoteConfig
  private let session: URLSession

  public init(config: RemoteConfig, session: URLSession? = nil) {
    self.config = config
    if let session {
      self.session = session
    } else {
      let c = URLSessionConfiguration.ephemeral
      c.timeoutIntervalForRequest = 15
      c.timeoutIntervalForResource = 30
      c.waitsForConnectivity = false
      self.session = URLSession(configuration: c)
    }
  }

  // MARK: Routes

  public func health() async throws -> Bool {
    struct Health: Decodable { var ok: Bool }
    let h: Health = try await get("/api/remote/health")
    return h.ok
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

  /// `agentId` maps to the laptop's `modelId` field (it is an agent id there).
  public func createThread(projectId: String, agentId: String?, prompt: String) async throws
    -> RemoteThreadSummary
  {
    struct Input: Encodable {
      var projectId: String
      var modelId: String?
      var prompt: String
    }
    struct Body: Decodable { var thread: RemoteThreadSummary }
    let b: Body = try await post(
      "/api/remote/threads", Input(projectId: projectId, modelId: agentId, prompt: prompt))
    return b.thread
  }

  public func sendPrompt(threadId: String, prompt: String) async throws {
    struct Input: Encodable { var prompt: String }
    struct Body: Decodable { var ok: Bool }
    let _: Body = try await post("/api/remote/threads/\(encode(threadId))/prompt", Input(prompt: prompt))
  }

  // MARK: Transport

  private func encode(_ segment: String) -> String {
    segment.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? segment
  }

  private func request(_ path: String, method: String, body: Data?) throws -> URLRequest {
    guard config.isComplete, let base = config.baseURL, let url = URL(string: path, relativeTo: base)
    else { throw config.token.isEmpty || config.host.isEmpty ? RemoteClientError.notPaired : .badURL }
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

  private func perform<T: Decodable>(_ req: URLRequest) async throws -> T {
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
      let text = String(data: data.prefix(300), encoding: .utf8) ?? ""
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
