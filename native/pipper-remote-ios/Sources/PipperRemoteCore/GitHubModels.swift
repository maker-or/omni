import Foundation

// Wire shapes for pipper.dev's /api/github/* routes (marketing/src/lib/github.ts).

public struct GitHubRepo: Codable, Hashable, Sendable, Identifiable {
  public var id: Int
  public var owner: String
  public var name: String
  public var fullName: String
  public var isPrivate: Bool

  /// Case-insensitive match for spoken/typed repo names: exact, prefix, then
  /// substring. A query with a slash ("maker-or/omni") matches the full name.
  public static func matching(_ query: String, in repos: [GitHubRepo]) -> [GitHubRepo] {
    query.contains("/")
      ? RemoteCatalog.rank(repos, query: query, key: \.fullName)
      : RemoteCatalog.rank(repos, query: query, key: \.name)
  }
}

public struct GitHubPullRequest: Codable, Hashable, Sendable {
  public enum Status: String, Codable, Sendable {
    case open
    case draft
  }

  public var number: Int
  public var title: String
  public var author: String
  public var description: String
  public var status: Status
  public var repository: String
  public var url: String
}

public struct CreatedGitHubIssue: Codable, Equatable, Sendable {
  public var number: Int
  public var title: String
  public var repository: String
  public var url: String
}

/// On-disk cache of the user's repos so Siri resolves names fast and offline.
public struct GitHubRepoStore: Sendable {
  public let fileURL: URL

  /// `<Application Support>/PipperRemote/github-repos.json`, beside the Mac catalog.
  public static func standard() -> GitHubRepoStore {
    let base =
      FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    return GitHubRepoStore(
      fileURL: base.appendingPathComponent("PipperRemote", isDirectory: true)
        .appendingPathComponent("github-repos.json"))
  }

  public func load() -> [GitHubRepo]? {
    guard let data = try? Data(contentsOf: fileURL) else { return nil }
    return try? JSONDecoder().decode([GitHubRepo].self, from: data)
  }

  public func save(_ repos: [GitHubRepo]) throws {
    try FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(repos).write(to: fileURL, options: .atomic)
  }

  public func clear() {
    try? FileManager.default.removeItem(at: fileURL)
  }
}
