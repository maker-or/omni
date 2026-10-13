import Foundation

public enum PipperCloudError: Error, LocalizedError, Equatable {
  case signedOut
  case notConfigured
  case unreachable(String)
  case server(status: Int, message: String)
  case decoding(String)

  public var errorDescription: String? {
    switch self {
    case .signedOut: return "Sign in to Pipper to use GitHub actions."
    case .notConfigured: return "This build of Pipper isn't set up for GitHub actions yet."
    case .unreachable(let why): return "Couldn't reach Pipper (\(why)). Check your connection and try again."
    case .server(_, let message): return message
    case .decoding(let why): return "Unexpected reply from Pipper (\(why))."
    }
  }
}

/// Client for pipper.dev's GitHub routes. Authenticates with the user's Clerk
/// session token, which `tokenProvider` fetches fresh for every request.
public struct PipperCloudClient: Sendable {
  public typealias TokenProvider = @Sendable () async throws -> String?

  public let baseURL: URL
  private let tokenProvider: TokenProvider
  private let session: URLSession

  public init(baseURL: URL, session: URLSession? = nil, tokenProvider: @escaping TokenProvider) {
    self.baseURL = baseURL
    self.session = session ?? RemoteClient.defaultSession()
    self.tokenProvider = tokenProvider
  }

  public func repos() async throws -> [GitHubRepo] {
    struct Body: Decodable { var repos: [GitHubRepo] }
    let b: Body = try await send("/api/github/repos.json", method: "GET", body: nil)
    return b.repos
  }

  /// The user's own open pull requests (pipper.dev caps the list).
  public func pullRequests() async throws -> [GitHubPullRequest] {
    struct Body: Decodable { var pullRequests: [GitHubPullRequest] }
    let b: Body = try await send("/api/github/pulls.json", method: "GET", body: nil)
    return b.pullRequests
  }

  public func createIssue(owner: String, repo: String, title: String, body: String?) async throws
    -> CreatedGitHubIssue
  {
    struct Input: Encodable { var owner: String; var repo: String; var title: String; var body: String? }
    struct Body: Decodable { var issue: CreatedGitHubIssue }
    let data = try JSONEncoder().encode(Input(owner: owner, repo: repo, title: title, body: body))
    let b: Body = try await send("/api/github/issues.json", method: "POST", body: data)
    return b.issue
  }

  private func send<T: Decodable>(_ path: String, method: String, body: Data?) async throws -> T {
    guard let token = try await tokenProvider(), !token.isEmpty else { throw PipperCloudError.signedOut }
    guard let url = URL(string: path, relativeTo: baseURL) else { throw PipperCloudError.notConfigured }
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    if body != nil { req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    req.httpBody = body

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: req)
    } catch {
      throw PipperCloudError.unreachable((error as NSError).localizedDescription)
    }
    guard let http = response as? HTTPURLResponse else {
      throw PipperCloudError.decoding("not an HTTP response")
    }
    guard (200..<300).contains(http.statusCode) else {
      if http.statusCode == 401 { throw PipperCloudError.signedOut }
      let text = String(data: data.prefix(16_384), encoding: .utf8) ?? ""
      let message = RemoteClient.errorMessage(from: text).trimmingCharacters(in: .whitespacesAndNewlines)
      throw PipperCloudError.server(
        status: http.statusCode, message: message.isEmpty ? "Pipper returned HTTP \(http.statusCode)." : message)
    }
    do {
      return try JSONDecoder().decode(T.self, from: data)
    } catch {
      throw PipperCloudError.decoding(String(describing: error))
    }
  }
}
