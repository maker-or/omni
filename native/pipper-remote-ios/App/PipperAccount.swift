import ClerkKit
import Foundation
import Observation

/// The user's Pipper account (Clerk, signed in with GitHub) and the GitHub
/// data Siri needs. Shared by the SwiftUI app and the in-process App Intents,
/// like `RemoteSession` is for the Mac.
@MainActor
@Observable
final class PipperAccount {
  static let shared = PipperAccount()

  /// Repos the user can file issues in, cached so Siri resolves names offline.
  private(set) var repos: [GitHubRepo]
  private(set) var reposError: String?
  private(set) var signInError: String?
  private(set) var signOutError: String?
  private(set) var signingIn = false

  let isConfigured: Bool
  let cloud: PipperCloudClient
  private let repoStore = GitHubRepoStore.standard()

  private init() {
    let info = Bundle.main.infoDictionary ?? [:]
    let publishableKey = (info["ClerkPublishableKey"] as? String ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let base = (info["PipperAPIBaseURL"] as? String).flatMap { URL(string: $0) }
      ?? URL(string: "https://www.pipper.dev")!
    // Clerk asserts on an invalid key, so an unconfigured build stays signed out.
    isConfigured = publishableKey.hasPrefix("pk_")
    if isConfigured { Clerk.configure(publishableKey: publishableKey) }
    let configured = isConfigured
    cloud = PipperCloudClient(baseURL: base) { @MainActor in
      guard configured else { throw PipperCloudError.notConfigured }
      return try await Clerk.shared.auth.getToken()
    }
    repos = repoStore.load() ?? []
  }

  var isSignedIn: Bool { isConfigured && Clerk.shared.user != nil }

  /// Shown in Settings: the GitHub username when available.
  var displayName: String? {
    guard isSignedIn, let user = Clerk.shared.user else { return nil }
    return user.username ?? user.primaryEmailAddress?.emailAddress
  }

  func signInWithGitHub() async {
    guard isConfigured else {
      signInError = PipperCloudError.notConfigured.localizedDescription
      return
    }
    signingIn = true
    defer { signingIn = false }
    do {
      try await Clerk.shared.auth.signInWithOAuth(provider: .github)
      signInError = nil
      await refreshRepos()
    } catch {
      signInError = error.localizedDescription
    }
  }

  func signOut() async {
    do {
      try await Clerk.shared.auth.signOut()
    } catch {
      // Still signed in: keep the cache that belongs to this account.
      signOutError = error.localizedDescription
      return
    }
    signOutError = nil
    repoStore.clear()
    repos = []
    reposError = nil
    PipperRemoteShortcuts.updateAppShortcutParameters()
  }

  /// Pull the repo list from pipper.dev, cache it, and tell Siri the names changed.
  @discardableResult
  func refreshRepos() async -> [GitHubRepo]? {
    guard isSignedIn, let userId = Clerk.shared.user?.id else { return nil }
    do {
      let fresh = try await cloud.repos()
      // Signed out or switched accounts while waiting: never cache the
      // previous account's (possibly private) repo names.
      guard Clerk.shared.user?.id == userId else { return nil }
      try? repoStore.save(fresh)
      repos = fresh
      reposError = nil
      PipperRemoteShortcuts.updateAppShortcutParameters()
      return fresh
    } catch {
      reposError = error.localizedDescription
      return nil
    }
  }
}
