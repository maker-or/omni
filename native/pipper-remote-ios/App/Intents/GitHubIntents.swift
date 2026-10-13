import AppIntents
import Foundation

// GitHub actions for Siri. They run against pipper.dev (never the Mac), using
// the user's Pipper account, which is signed in with GitHub.

enum GitHubIntentError: Error, CustomLocalizedStringResourceConvertible {
  case signedOut
  case repoNotFound(String)
  case cloud(String)

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .signedOut: return "Open Pipper and sign in with GitHub first."
    case .repoNotFound(let name): return "Couldn't find the repository \(name) in your GitHub account."
    case .cloud(let message): return "\(message)"
    }
  }

  static func from(_ error: Error) -> GitHubIntentError {
    if case PipperCloudError.signedOut = error { return .signedOut }
    return .cloud(error.localizedDescription)
  }
}

// MARK: - Repository

struct RepositoryEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Repository"
  static var defaultQuery = RepositoryQuery()

  /// "owner/name": stable, and exactly what the API needs.
  var id: String
  var owner: String
  var name: String

  var displayRepresentation: DisplayRepresentation {
    // The title is the bare name so "File an issue in omni" matches by voice.
    DisplayRepresentation(title: "\(name)", subtitle: "\(owner)", image: .init(systemName: "book.closed"))
  }

  init(_ repo: GitHubRepo) {
    id = repo.fullName
    owner = repo.owner
    name = repo.name
  }

  /// A saved repo that isn't in the cached list keeps its id, so the request
  /// still reaches GitHub and reports a real error.
  init?(fullName: String) {
    let parts = fullName.split(separator: "/", maxSplits: 1).map(String.init)
    guard parts.count == 2 else { return nil }
    id = fullName
    owner = parts[0]
    name = parts[1]
  }
}

struct RepositoryQuery: EntityStringQuery {
  /// Cached repos first (fast, offline); pipper.dev only when the cache misses.
  @MainActor
  private func repos(refreshIf needed: @Sendable ([GitHubRepo]) -> Bool) async -> [GitHubRepo] {
    let account = PipperAccount.shared
    // The cache outlives an expired session; only the signed-in user sees it.
    guard account.isSignedIn else { return [] }
    if needed(account.repos), let fresh = await account.refreshRepos() { return fresh }
    return account.repos
  }

  func entities(for identifiers: [String]) async throws -> [RepositoryEntity] {
    let cached = await MainActor.run {
      PipperAccount.shared.isSignedIn ? PipperAccount.shared.repos : []
    }
    return identifiers.compactMap { id in
      cached.first { $0.fullName == id }.map(RepositoryEntity.init) ?? RepositoryEntity(fullName: id)
    }
  }

  func entities(matching string: String) async throws -> [RepositoryEntity] {
    let repos = await repos { GitHubRepo.matching(string, in: $0).isEmpty }
    return GitHubRepo.matching(string, in: repos).map(RepositoryEntity.init)
  }

  func suggestedEntities() async throws -> [RepositoryEntity] {
    await repos { $0.isEmpty }.prefix(20).map(RepositoryEntity.init)
  }
}

// MARK: - File an issue

struct FileGitHubIssueIntent: AppIntent {
  static var title: LocalizedStringResource = "File GitHub issue"
  static var description = IntentDescription(
    "Files a new issue in one of your GitHub repositories after you confirm it.",
    categoryName: "GitHub")
  static var openAppWhenRun: Bool = false

  @Parameter(
    title: "Repository", description: "The GitHub repository to file the issue in",
    requestValueDialog: "Which repository?")
  var repository: RepositoryEntity

  @Parameter(
    title: "Title", description: "A short summary of the issue",
    requestValueDialog: "What's the issue?")
  var title: String

  @Parameter(title: "Details", description: "More detail about the issue")
  var details: String?

  static var parameterSummary: some ParameterSummary {
    Summary("File \(\.$title) in \(\.$repository)") {
      \.$details
    }
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<URL> {
    guard await MainActor.run(body: { PipperAccount.shared.isSignedIn }) else {
      throw GitHubIntentError.signedOut
    }
    let issueTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !issueTitle.isEmpty else { throw $title.needsValueError("What's the issue?") }
    let body = details?.trimmingCharacters(in: .whitespacesAndNewlines)

    // Always confirm: this writes to GitHub on the user's behalf.
    try await requestConfirmation(
      actionName: .create, dialog: "File “\(issueTitle)” in \(repository.id)?")

    let cloud = await MainActor.run { PipperAccount.shared.cloud }
    let issue: CreatedGitHubIssue
    do {
      issue = try await cloud.createIssue(
        owner: repository.owner, repo: repository.name, title: issueTitle,
        body: body?.isEmpty == false ? body : nil)
    } catch {
      throw GitHubIntentError.from(error)
    }
    let url = URL(string: issue.url) ?? URL(string: "https://github.com/\(issue.repository)/issues")!
    return .result(value: url, dialog: "Filed issue #\(issue.number) in \(issue.repository).")
  }
}

// MARK: - Summarize my pull requests

struct PullRequestEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Pull Request"
  static var defaultQuery = PullRequestQuery()

  /// The PR's URL: unique across repositories.
  var id: String

  @Property(title: "Number") var number: Int
  @Property(title: "Title") var title: String
  @Property(title: "Author") var author: String
  @Property(title: "Description") var summary: String
  @Property(title: "Status") var status: String
  @Property(title: "Repository") var repository: String

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "#\(number) \(title)", subtitle: "\(repository) · \(status)")
  }

  init(_ pr: GitHubPullRequest) {
    id = pr.url
    number = pr.number
    title = pr.title
    author = pr.author
    summary = pr.description
    status = pr.status == .draft ? "Draft" : "Open"
    repository = pr.repository
  }
}

struct PullRequestQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [PullRequestEntity] {
    let cloud = await MainActor.run { PipperAccount.shared.cloud }
    let prs = (try? await cloud.pullRequests()) ?? []
    return prs.filter { identifiers.contains($0.url) }.map(PullRequestEntity.init)
  }
}

/// Returns structured data and no dialog on purpose: Siri summarizes the list
/// itself; a dialog of ours would be read out instead.
struct SummarizeMyPullRequestsIntent: AppIntent {
  static var title: LocalizedStringResource = "Summarize my pull requests"
  static var description = IntentDescription(
    "Gets your open GitHub pull requests with their number, title, author, description, repository, and status (open or draft).",
    categoryName: "GitHub")
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult & ReturnsValue<[PullRequestEntity]> {
    guard await MainActor.run(body: { PipperAccount.shared.isSignedIn }) else {
      throw GitHubIntentError.signedOut
    }
    let cloud = await MainActor.run { PipperAccount.shared.cloud }
    do {
      return .result(value: try await cloud.pullRequests().map(PullRequestEntity.init))
    } catch {
      throw GitHubIntentError.from(error)
    }
  }
}
