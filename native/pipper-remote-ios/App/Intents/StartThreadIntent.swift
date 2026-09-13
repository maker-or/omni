import AppIntents
import Foundation

enum StartThreadError: Error, CustomLocalizedStringResourceConvertible {
  case notPaired
  case noAgent
  case agentUnavailable(String)
  case remote(String)

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .notPaired:
      return "Pipper isn't paired with your Mac yet. Open the app and scan the pairing code."
    case .noAgent:
      return "No agent is installed on your Mac. Pick one in Pipper on the Mac first."
    case .agentUnavailable(let name):
      return "\(name) isn't available on your Mac right now. Pick another agent."
    case .remote(let message):
      return "\(message)"
    }
  }
}

/// Siri-first entry point: "Start a Pipper thread in FolkLore with Codex".
/// Runs in the app process in the background (no app launch), POSTs to the
/// laptop over Tailscale, and speaks the result.
struct StartThreadIntent: AppIntent {
  static var title: LocalizedStringResource = "Start Pipper thread"
  static var description = IntentDescription(
    "Starts a new agent thread on your Mac in a chosen project.",
    categoryName: "Productivity")
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Project", description: "The project on your Mac to work in")
  var project: ProjectEntity

  @Parameter(title: "Agent", description: "The coding agent to run. Uses your Mac's default when omitted.")
  var agent: AgentEntity?

  @Parameter(
    title: "Task",
    description: "What the agent should do",
    requestValueDialog: "What should the thread work on?")
  var prompt: String

  static var parameterSummary: some ParameterSummary {
    Summary("Start \(\.$prompt) in \(\.$project)") {
      \.$agent
    }
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
    let session = await MainActor.run { RemoteSession.shared }
    guard let client = await MainActor.run(body: { session.client }) else {
      throw StartThreadError.notPaired
    }
    // Re-validate against the freshest catalog we can get: availability may
    // have changed since the parameter was picked.
    var catalog = await session.refreshCatalog()
    if catalog == nil { catalog = await MainActor.run { session.catalog } }
    guard let catalog else { throw StartThreadError.notPaired }
    let chosenAgent: RemoteCatalogAgent
    if let agent {
      guard let live = catalog.agent(id: agent.id), live.available else {
        throw StartThreadError.agentUnavailable(agent.displayName)
      }
      chosenAgent = live
    } else {
      guard let preferred = catalog.preferredAgent else { throw StartThreadError.noAgent }
      chosenAgent = preferred
    }
    let task = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !task.isEmpty else {
      throw $prompt.needsValueError("What should the thread work on?")
    }

    let thread: RemoteThreadSummary
    do {
      thread = try await client.createThread(projectId: project.id, agentId: chosenAgent.id, prompt: task)
    } catch {
      throw StartThreadError.remote(error.localizedDescription)
    }
    await MainActor.run { session.lastSiriThreadId = thread.id }
    return .result(
      value: thread.id,
      dialog: "Started a thread in \(project.name) with \(chosenAgent.displayName). I'll keep it running on your Mac.")
  }
}

/// "Is my Mac reachable?" — quick diagnostic that also proves pairing works.
struct CheckMacIntent: AppIntent {
  static var title: LocalizedStringResource = "Check Pipper Mac"
  static var description = IntentDescription(
    "Checks whether your Mac is reachable over Tailscale and how many threads are running.",
    categoryName: "Productivity")
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let session = await MainActor.run { RemoteSession.shared }
    guard let client = await MainActor.run(body: { session.client }) else {
      throw StartThreadError.notPaired
    }
    do {
      let threads = try await client.listThreads()
      let running = threads.filter(\.running).count
      await session.refreshCatalog()
      if running == 0 {
        return .result(dialog: "Your Mac is reachable. Nothing is running right now.")
      }
      return .result(dialog: "Your Mac is reachable. \(running) thread\(running == 1 ? " is" : "s are") running.")
    } catch {
      throw StartThreadError.remote(error.localizedDescription)
    }
  }
}
