import AppIntents
import Foundation

/// "How's my Pipper thread?" — reads a thread's progress without opening the
/// app. With no thread named, checks the one most recently used on the Mac.
struct GetThreadStatusIntent: AppIntent {
  static var title: LocalizedStringResource = "Get Pipper thread status"
  static var description = IntentDescription(
    "Reads the latest progress of a thread on your Mac. Returns the spoken status.",
    categoryName: "Productivity")
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Thread", description: "The thread to check. Uses the most recent one when omitted.")
  var thread: ThreadEntity?

  static var parameterSummary: some ParameterSummary {
    Summary("Get the status of \(\.$thread)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
    let session = await MainActor.run { RemoteSession.shared }
    guard let client = await MainActor.run(body: { session.client }) else {
      throw StartThreadError.notPaired
    }
    let target = try await IntentThreads.resolve(thread)
    let report: RemoteReport
    do {
      report = try await client.report(threadId: target.id)
    } catch {
      throw StartThreadError.remote(error.localizedDescription)
    }
    let status = report.spokenStatus()
    let title = report.summary.flatMap { $0.isEmpty ? nil : $0 } ?? target.title
    return .result(value: status, dialog: "\(title): \(status)")
  }
}

/// "Follow up in Pipper" — sends another message to a thread on the Mac.
/// Siri confirms the target first when no thread was named, so a follow-up
/// never lands silently in a thread the user didn't expect.
struct SendFollowUpIntent: AppIntent {
  static var title: LocalizedStringResource = "Send Pipper follow-up"
  static var description = IntentDescription(
    "Sends a follow-up message to a thread on your Mac.",
    categoryName: "Productivity")
  static var openAppWhenRun: Bool = false

  @Parameter(
    title: "Message",
    description: "What the agent should do next",
    requestValueDialog: "What should the agent do next?")
  var prompt: String

  @Parameter(title: "Thread", description: "The thread to continue. Uses the most recent one when omitted.")
  var thread: ThreadEntity?

  static var parameterSummary: some ParameterSummary {
    Summary("Send \(\.$prompt) to \(\.$thread)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let session = await MainActor.run { RemoteSession.shared }
    guard await MainActor.run(body: { session.isPaired }) else {
      throw StartThreadError.notPaired
    }
    let message = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !message.isEmpty else {
      throw $prompt.needsValueError("What should the agent do next?")
    }
    let target = try await IntentThreads.resolve(thread)
    if thread == nil {
      try await requestConfirmation(actionName: .send, dialog: "Send this to \(target.title)?")
    }
    do {
      try await session.sendPrompt(threadId: target.id, prompt: message)
    } catch {
      throw StartThreadError.remote(error.localizedDescription)
    }
    await MainActor.run { session.lastSiriThreadId = target.id }
    return .result(
      dialog: "Sent to \(target.title). Ask Pipper for the thread status to hear how it's going.")
  }
}
