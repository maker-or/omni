import AppIntents
import Foundation
import OSLog

enum SiriDiagnostics {
  private static let logger = Logger(
    subsystem: "com.maker-or.omni.pipper",
    category: "AppIntents"
  )

  static func log(_ message: String) {
    let line = "[PipperIntents] \(message)\n"
    logger.info("\(message, privacy: .public)")

    let url = SiriCatalogStore.realHomeDirectory()
      .appendingPathComponent("Library/pipper/intents-debug.log")
    do {
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      if FileManager.default.fileExists(atPath: url.path),
        let handle = try? FileHandle(forWritingTo: url)
      {
        handle.seekToEndOfFile()
        handle.write(Data(line.utf8))
        try? handle.close()
      } else {
        try Data(line.utf8).write(to: url, options: .atomic)
      }
    } catch {
      logger.error("file log failed: \(error.localizedDescription, privacy: .public)")
    }
  }
}

// MARK: - Shared catalog (written by Electron, read by Siri)

struct SiriCatalogProject: Codable, Sendable {
  var id: String
  var name: String
  var path: String
}

struct SiriCatalogAgent: Codable, Sendable {
  var id: String
  var displayName: String
  var available: Bool
}

struct SiriCatalog: Codable, Sendable {
  var version: Int
  var updatedAt: String
  var defaultAgentId: String
  var projects: [SiriCatalogProject]
  var agents: [SiriCatalogAgent]
}

enum SiriCatalogStore {
  /// App Intents extensions must run in the App Sandbox. The containing
  /// Electron app and this extension share the catalog through this group.
  static let appGroupIdentifier = "group.com.maker-or.omni.pipper"

  /// The Xcode preview host has no Electron process to populate the live
  /// catalog. Keep its metadata/action preview useful without exposing these
  /// sample entities in the packaged app.
  static var isPreviewExtension: Bool {
    Bundle.main.bundleIdentifier?.hasPrefix("dev.pipper.PipperIntentsPreview") == true
  }

  /// Real user home. homeDirectoryForCurrentUser returns the sandbox
  /// container inside an App Intents extension, not /Users/<name>.
  static func realHomeDirectory() -> URL {
    if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
      let path = String(cString: dir)
      if !path.isEmpty { return URL(fileURLWithPath: path, isDirectory: true) }
    }
    return FileManager.default.homeDirectoryForCurrentUser
  }

  /// Ad-hoc builds have no Team ID, so App Group containers are denied.
  /// Primary is ~/Library/pipper (temporary-exception), with Group Container
  /// as legacy fallback for users migrating from signed builds.
  static func candidateDirs() -> [URL] {
    if let overridePath = ProcessInfo.processInfo.environment["PIPPER_LIBRARY_PATH"],
      !overridePath.isEmpty
    {
      return [URL(fileURLWithPath: overridePath, isDirectory: true)]
    }
    let home = realHomeDirectory()
    var dirs: [URL] = []
    dirs.append(
      home.appendingPathComponent("Library/pipper", isDirectory: true))
    dirs.append(
      home.appendingPathComponent("Library/Application Support/Pipper", isDirectory: true))
    if let groupURL = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroupIdentifier
    ) {
      dirs.append(groupURL)
    }
    // Deduplicate while preserving order.
    var seen = Set<String>()
    return dirs.filter { seen.insert($0.path).inserted }
  }

  static func baseDir() -> URL {
    candidateDirs()[0]
  }

  static func catalogURL() -> URL {
    baseDir().appendingPathComponent("siri-catalog.json")
  }

  static func requestsDir() -> URL {
    baseDir().appendingPathComponent("siri-requests", isDirectory: true)
  }

  static func load() -> SiriCatalog? {
    SiriDiagnostics.log("catalog load begin dirs=\(candidateDirs().map(\.path))")
    for dir in candidateDirs() {
      let url = dir.appendingPathComponent("siri-catalog.json")
      guard let data = try? Data(contentsOf: url) else {
        SiriDiagnostics.log("catalog load miss path=\(url.path)")
        continue
      }
      do {
        let catalog = try JSONDecoder().decode(SiriCatalog.self, from: data)
        SiriDiagnostics.log(
          "catalog load success path=\(url.path) projects=\(catalog.projects.count) agents=\(catalog.agents.count)"
        )
        return catalog
      } catch {
        SiriDiagnostics.log("catalog decode failed path=\(url.path) error=\(error)")
      }
    }
    guard isPreviewExtension else {
      SiriDiagnostics.log("catalog load failed: no usable catalog")
      return nil
    }
    SiriDiagnostics.log("catalog load using preview catalog")
    return SiriCatalog(
      version: 1,
      updatedAt: "preview",
      defaultAgentId: "preview-agent",
      projects: [
        SiriCatalogProject(
          id: "preview-project",
          name: "Demo Project",
          path: "/tmp/pipper-preview-project"
        )
      ],
      agents: [
        SiriCatalogAgent(
          id: "preview-agent",
          displayName: "Preview Agent",
          available: true
        )
      ]
    )
  }
}

// MARK: - Options (String IDs + pickers; AppEntity decoding fails pre-perform, see intents-debug.log LNPerformActionErrorCodeUnsupportedValueType)
// decoding a saved AppEntity value before perform(). These providers retain
// the same named pickers while passing the stable catalog IDs as Strings.
struct ProjectOptionsProvider: DynamicOptionsProvider {
  typealias Result = IntentItemCollection<String>
  typealias DefaultValue = String

  func results() async throws -> IntentItemCollection<String> {
    let projects = SiriCatalogStore.load()?.projects ?? []
    let items = projects.map {
      IntentItem(
        $0.id,
        title: LocalizedStringResource(stringLiteral: $0.name),
        subtitle: LocalizedStringResource(stringLiteral: $0.path)
      )
    }
    return IntentItemCollection(sections: [IntentItemSection(items: items)])
  }
}

struct AgentOptionsProvider: DynamicOptionsProvider {
  typealias Result = IntentItemCollection<String>
  typealias DefaultValue = String

  func results() async throws -> IntentItemCollection<String> {
    let agents = SiriCatalogStore.load()?.agents.filter(\.available) ?? []
    let items = agents.map {
      IntentItem(
        $0.id,
        title: LocalizedStringResource(stringLiteral: $0.displayName)
      )
    }
    return IntentItemCollection(sections: [IntentItemSection(items: items)])
  }
}

enum SiriRequestError: Error, CustomLocalizedStringResourceConvertible {
  case encodingFailed
  case stagingFailed
  case projectUnavailable(String)
  case agentUnavailable(String)

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .encodingFailed: return "Couldn't prepare the thread request."
    case .stagingFailed: return "Couldn't save the thread request. Please try again."
    case .projectUnavailable(let id):
      return "The project \(id) isn't available. Pick an available project."
    case .agentUnavailable(let name):
      return "The agent \(name) isn't available. Pick an installed agent."
    }
  }
}

// MARK: - Intent: start a thread (confirm-then-create)

struct StartThreadIntent: AppIntent {
  static var title: LocalizedStringResource = "Start Pipper thread"
  static var description = IntentDescription(
    "Starts a new thread in a Pipper project with a chosen agent.",
    categoryName: "Productivity"
  )
static var isDiscoverable: Bool = true
  // Ad-hoc-signed builds cannot use App Intents' host-app launch handshake.
  // The result below opens the app's registered URL scheme instead.
  static var openAppWhenRun: Bool = false

  static func debugLog(_ message: String) {
    SiriDiagnostics.log(message)
  }

  @Parameter(title: "Project", description: "name of the project to run the agent in", optionsProvider: ProjectOptionsProvider()) var projectId: String
  @Parameter(title: "Agent", description: "the agent to run", optionsProvider: AgentOptionsProvider()) var agentId: String
  @Parameter(title: "Task",description: "what action or a task in perform in a project with an agent", requestValueDialog: "What should the thread work on?") var prompt: String?

  func perform() async throws -> some IntentResult & ProvidesDialog {
    Self.debugLog("perform entered")
    Self.debugLog("perform start projectId=\(projectId) agentId=\(agentId) promptLen=\(prompt?.count ?? 0)")
    Self.debugLog("candidateDirs=\(SiriCatalogStore.candidateDirs().map { $0.path })")
    let catalog = SiriCatalogStore.load()
    Self.debugLog("catalog loaded: projects=\(catalog?.projects.count ?? -1) agents=\(catalog?.agents.count ?? -1)")
    guard let chosenProject = catalog?.projects.first(where: { $0.id == projectId }) else {
      Self.debugLog("perform rejected projectId=\(projectId) reason=unavailable")
      throw SiriRequestError.projectUnavailable(projectId)
    }
    // Revalidate availability at run time: the catalog may have changed
    // between entity resolution and perform().
    let usableIds = Set((catalog?.agents ?? []).filter { $0.available }.map { $0.id })
    guard usableIds.contains(agentId) else {
      let agentName = catalog?.agents.first(where: { $0.id == agentId })?.displayName ?? agentId
      Self.debugLog("perform rejected agentId=\(agentId) reason=unavailable")
      throw SiriRequestError.agentUnavailable(agentName)
    }
    Self.debugLog("perform validation passed agentId=\(agentId)")
    if SiriCatalogStore.isPreviewExtension {
      return .result(
        dialog: "Preview: would start a thread in \(chosenProject.name)."
      )
    }
    // Stage a pending request. The host app is opened automatically after the
    // intent completes and Electron consumes this file during activation.
    let requestId = UUID().uuidString
    let payload: [String: String] = [
      "requestId": requestId,
      "projectId": projectId,
      "agentId": agentId,
      "prompt": prompt ?? "",
    ]
    let dir = SiriCatalogStore.baseDir().appendingPathComponent("siri-requests", isDirectory: true)
    // Stage into every candidate dir so Electron finds the request no
    // matter which location it consumes from. One location failing (e.g.
    //Sandbox denying the group container) must not fail the whole intent.
    var stagedCount = 0
    var lastError: Error?
    for base in SiriCatalogStore.candidateDirs() {
      do {
        let target = base.appendingPathComponent("siri-requests", isDirectory: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        let url = target.appendingPathComponent("\(requestId).json")
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
          throw SiriRequestError.encodingFailed
        }
        try data.write(to: url, options: .atomic)
        stagedCount += 1
        Self.debugLog("stage succeeded dir=\(base.path) requestId=\(requestId)")
      } catch {
        Self.debugLog("stage failed dir=\(base.path) error=\(error)")
        lastError = error
      }
    }
    Self.debugLog("stagedCount=\(stagedCount) lastError=\(String(describing: lastError))")
    _ = dir
    if stagedCount == 0 {
      if let siriError = lastError as? SiriRequestError {
        throw siriError
      }
      throw SiriRequestError.stagingFailed
    }
    if #available(macOS 15.2, *) {
      let openURL = URL(string: "pipper://siri/\(requestId)")!
      return .result(
        opensIntent: OpenURLIntent(openURL),
        dialog: "Starting a thread in \(chosenProject.name)."
      )
    }
    return .result(dialog: "Starting a thread in \(chosenProject.name).")
  }
}

// MARK: - Temporary bisect intent (no parameters, no entities)

struct PingIntent: AppIntent {
  static var title: LocalizedStringResource = "Ping Pipper"
  static var description = IntentDescription(
    "Temporary diagnostic action. Always succeeds.",
    categoryName: "Productivity"
  )

  func perform() async throws -> some IntentResult & ProvidesDialog {
    return .result(dialog: "Pipper is reachable.")
  }
}

// MARK: - Temporary bisect intent (string parameter only, no entities)

struct PingWithTextIntent: AppIntent {
  static var title: LocalizedStringResource = "Ping Pipper With Text"
  static var description = IntentDescription(
    "Temporary diagnostic action with a text parameter.",
    categoryName: "Productivity"
  )

  @Parameter(title: "Task") var prompt: String?

  func perform() async throws -> some IntentResult & ProvidesDialog {
    StartThreadIntent.debugLog("pingWithText entered promptLen=\(prompt?.count ?? -1)")
    // Static dialog: bisects interpolated-dialog failure vs parameter failure.
    return .result(dialog: "Text received.")
  }
}

// MARK: - Shortcuts registration (Siri phrases must contain applicationName)

struct PipperShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartThreadIntent(),
      phrases: [
        "Start a thread in \(.applicationName)",
        "New thread in \(.applicationName)",
        "Start a thread with \(.applicationName)",
      ],
      shortTitle: "Start thread",
      systemImageName: "bubble.left.and.text.bubble.right"
    )
  }
}
