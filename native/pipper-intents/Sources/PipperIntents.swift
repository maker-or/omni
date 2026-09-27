import AppIntents
import Foundation
import OSLog

enum SiriDiagnostics {
  private static let logger = Logger(
    subsystem: "com.maker-or.omni.pipper",
    category: "AppIntents"
  )

  /// File logging is a development aid: it adds disk I/O to every intent run
  /// and can accumulate prompt metadata on user machines. Keep it for debug
  /// builds only, with an explicit env override for release-build triage.
  private static let fileLoggingEnabled: Bool = {
    if ProcessInfo.processInfo.environment["PIPPER_INTENTS_FILE_LOG"] == "1" { return true }
    #if DEBUG
      return true
    #else
      return false
    #endif
  }()

  /// Cap the on-disk log so a long-running build can't grow it without bound.
  /// Once exceeded, the file is reset with the newest line.
  private static let maxFileLogBytes = 1 * 1024 * 1024

  static func log(_ message: String) {
    logger.info("\(message, privacy: .public)")
    guard fileLoggingEnabled else { return }

    let url = SiriCatalogStore.realHomeDirectory()
      .appendingPathComponent("Library/pipper/intents-debug.log")
    do {
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      let data = Data("[PipperIntents] \(message)\n".utf8)
      let size =
        (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int ?? 0
      if size + data.count > maxFileLogBytes {
        // Truncate rather than append: the log is a rolling diagnostic aid.
        try data.write(to: url, options: .atomic)
      } else if FileManager.default.fileExists(atPath: url.path),
        let handle = try? FileHandle(forWritingTo: url)
      {
        handle.seekToEndOfFile()
        handle.write(data)
        try? handle.close()
      } else {
        try data.write(to: url, options: .atomic)
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

  /// Ad-hoc builds have no Team ID, so App Group containers are denied; the
  /// extension reaches these home-relative paths via temporary-exception
  /// entitlements instead. Primary is ~/Library/pipper.
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
    return dirs
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

// MARK: - Options (String values + pickers)
//
// AppEntity parameters fail to decode before perform() on ad-hoc builds
// (LNPerformActionErrorCodeUnsupportedValueType), so parameters are Strings
// with DynamicOptionsProviders. Spotlight renders the raw String value and
// ignores IntentItem titles, so the value must be the human-readable label;
// perform() resolves it back to the catalog id. Raw ids are still accepted
// so Shortcuts saved before this change keep working.

enum SiriCatalogLabels {
  /// Project label: the name, disambiguated with the path when two projects
  /// share a name.
  static func projectLabel(_ project: SiriCatalogProject, in all: [SiriCatalogProject]) -> String {
    let duplicates = all.filter { $0.name == project.name }.count > 1
    return duplicates ? "\(project.name) (\(project.path))" : project.name
  }

  /// Split a rendered label back into its base name and disambiguation suffix:
  /// `"app (/tmp/a)"` → `("app", "/tmp/a")`, `"app"` → `("app", nil)`.
  static func split(_ label: String) -> (base: String, suffix: String?) {
    guard label.hasSuffix(")"), let open = label.range(of: " (", options: .backwards)
    else { return (label, nil) }
    let base = String(label[label.startIndex..<open.lowerBound])
    let suffix = String(label[open.upperBound..<label.index(before: label.endIndex)])
    return (base, suffix)
  }

  /// Resolve a stored picker value to a project. Values come from
  /// `projectLabel`, which disambiguates duplicate names with the path — but
  /// the project set (and therefore the label) changes over time, while saved
  /// Shortcuts keep the old string. Match, in order: catalog id, the exact
  /// current label, a raw path, the base name plus a stable suffix (id or
  /// path), then a unique base-name match.
  static func resolveProject(_ value: String, in all: [SiriCatalogProject]) -> SiriCatalogProject? {
    if let byId = all.first(where: { $0.id == value }) { return byId }
    if let byLabel = all.first(where: { projectLabel($0, in: all) == value }) { return byLabel }
    if let byPath = all.first(where: { $0.path == value }) { return byPath }
    let (base, suffix) = split(value)
    let named = all.filter { $0.name == base }
    guard !named.isEmpty else { return nil }
    if let suffix, let bySuffix = named.first(where: { $0.id == suffix || $0.path == suffix }) {
      return bySuffix
    }
    return named.count == 1 ? named[0] : nil
  }

  static func agentLabel(_ agent: SiriCatalogAgent, in all: [SiriCatalogAgent]) -> String {
    let duplicates = all.filter { $0.displayName == agent.displayName }.count > 1
    return duplicates ? "\(agent.displayName) (\(agent.id))" : agent.displayName
  }

  /// Agent counterpart to `resolveProject`: tolerate a stored label whose
  /// disambiguation suffix no longer matches the live catalog.
  static func resolveAgent(_ value: String, in all: [SiriCatalogAgent]) -> SiriCatalogAgent? {
    if let byId = all.first(where: { $0.id == value }) { return byId }
    if let byLabel = all.first(where: { agentLabel($0, in: all) == value }) { return byLabel }
    let (base, suffix) = split(value)
    let named = all.filter { $0.displayName == base }
    guard !named.isEmpty else { return nil }
    if let suffix, let bySuffix = named.first(where: { $0.id == suffix }) {
      return bySuffix
    }
    return named.count == 1 ? named[0] : nil
  }
}

struct ProjectOptionsProvider: DynamicOptionsProvider {
  typealias Result = IntentItemCollection<String>
  typealias DefaultValue = String

  func results() async throws -> IntentItemCollection<String> {
    let projects = SiriCatalogStore.load()?.projects ?? []
    let items = projects.map {
      IntentItem(
        SiriCatalogLabels.projectLabel($0, in: projects),
        title: LocalizedStringResource(stringLiteral: $0.name),
        subtitle: LocalizedStringResource(stringLiteral: $0.path),
        image: .init(systemName: "folder")
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
        SiriCatalogLabels.agentLabel($0, in: agents),
        title: LocalizedStringResource(stringLiteral: $0.displayName),
        image: .init(systemName: "cpu")
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
  // App Intents metadata requires a compile-time constant. Ad-hoc builds use
  // OpenURLIntent instead of the host-app launch handshake.
  static var openAppWhenRun: Bool = false

  static func debugLog(_ message: String) {
    SiriDiagnostics.log(message)
  }

  @Parameter(title: "Project", description: "name of the project to run the agent in", optionsProvider: ProjectOptionsProvider()) var projectId: String
  @Parameter(title: "Agent", description: "the agent to run", optionsProvider: AgentOptionsProvider()) var agentId: String
  // Required (not `String?`): App Intents only asks for required parameters,
  // so an optional task was silently skipped when run from Spotlight/Siri.
  @Parameter(title: "Task", description: "what action or a task to perform in a project with an agent", requestValueDialog: "What should the thread work on?") var prompt: String

  // Spotlight (macOS 26+) renders this sentence inline in the search bar with
  // each parameter as a fillable token, like Mail's "Send [Message] with
  // [Subject] to [Recipients]". Free text goes first so the cursor lands there.
  static var parameterSummary: some ParameterSummary {
    Summary("Start \(\.$prompt) in \(\.$projectId) with \(\.$agentId)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard #available(macOS 15.2, *) else {
      throw NSError(domain: "PipperIntents", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Starting Pipper from Shortcuts requires macOS 15.2 or later. Open Pipper to start this task."])
    }
    Self.debugLog("perform entered")
    Self.debugLog("perform start projectId=\(projectId) agentId=\(agentId) promptLen=\(prompt.count)")
    Self.debugLog("candidateDirs=\(SiriCatalogStore.candidateDirs().map { $0.path })")
    let catalog = SiriCatalogStore.load()
    Self.debugLog("catalog loaded: projects=\(catalog?.projects.count ?? -1) agents=\(catalog?.agents.count ?? -1)")
    guard
      let chosenProject = SiriCatalogLabels.resolveProject(projectId, in: catalog?.projects ?? [])
    else {
      Self.debugLog("perform rejected project=\(projectId) reason=unavailable")
      throw SiriRequestError.projectUnavailable(projectId)
    }
    // Revalidate availability at run time: the catalog may have changed
    // between picking and perform().
    let agents = catalog?.agents ?? []
    guard let chosenAgent = SiriCatalogLabels.resolveAgent(agentId, in: agents), chosenAgent.available
    else {
      let agentName = SiriCatalogLabels.resolveAgent(agentId, in: agents)?.displayName ?? agentId
      Self.debugLog("perform rejected agent=\(agentId) reason=unavailable")
      throw SiriRequestError.agentUnavailable(agentName)
    }
    Self.debugLog("perform validation passed projectId=\(chosenProject.id) agentId=\(chosenAgent.id)")
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
      "projectId": chosenProject.id,
      "agentId": chosenAgent.id,
      "prompt": prompt,
    ]
    // Stage into every candidate dir so Electron finds the request no
    // matter which location it consumes from. One location failing must
    // not fail the whole intent.
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

// MARK: - Diagnostic intents (debug builds only)
//
// These exist to bisect App Intents failures and have no user value, so they
// must not be discoverable in release builds.

#if DEBUG
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
#endif

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
