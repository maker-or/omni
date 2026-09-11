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

// MARK: - Entities (both dynamic -> AppEntity, not AppEnum)

struct ProjectEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Project"
  static var defaultQuery = ProjectEntityQuery()

  var id: String
  @Property(title: "Name") var name: String
  @Property(title: "Path") var path: String

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)", subtitle: "\(path)")
  }

  init(id: String, name: String, path: String) {
    self.id = id
    self.name = name
    self.path = path
  }
}

struct ProjectEntityQuery: EnumerableEntityQuery, EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [ProjectEntity] {
    StartThreadIntent.debugLog("projectQuery.entities identifiers=\(identifiers)")
    let all = SiriCatalogStore.load()?.projects ?? []
    let result = all.filter { identifiers.contains($0.id) }.map {
      ProjectEntity(id: $0.id, name: $0.name, path: $0.path)
    }
    StartThreadIntent.debugLog("projectQuery.entities resolved=\(result.map(\.id))")
    return result
  }

  func suggestedEntities() async throws -> [ProjectEntity] {
    StartThreadIntent.debugLog("projectQuery.suggested begin")
    return try await allEntities()
  }

  func allEntities() async throws -> [ProjectEntity] {
    StartThreadIntent.debugLog("projectQuery.all begin")
    let all = SiriCatalogStore.load()?.projects ?? []
    let result = all.map { ProjectEntity(id: $0.id, name: $0.name, path: $0.path) }
    StartThreadIntent.debugLog("projectQuery.all resultCount=\(result.count)")
    return result
  }

  func entities(matching string: String) async throws -> [ProjectEntity] {
    StartThreadIntent.debugLog("projectQuery.match begin inputLen=\(string.count)")
    let all = SiriCatalogStore.load()?.projects ?? []
    let result = all.filter {
      $0.name.localizedCaseInsensitiveContains(string)
        || $0.path.localizedCaseInsensitiveContains(string)
    }.map { ProjectEntity(id: $0.id, name: $0.name, path: $0.path) }
    StartThreadIntent.debugLog("projectQuery.match resultCount=\(result.count)")
    return result
  }
}

struct AgentEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Agent"
  static var defaultQuery = AgentEntityQuery()

  var id: String
  @Property(title: "Name") var name: String
  var available: Bool

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)")
  }

  init(id: String, name: String, available: Bool) {
    self.id = id
    self.available = available
    self.name = name
  }
}

struct AgentEntityQuery: EnumerableEntityQuery, EntityStringQuery {
  /// Only usable agents are ever offered — staging a thread for a missing
  /// CLI would fail later in Electron.
  private func usableAgents() -> [SiriCatalogAgent] {
    let all = SiriCatalogStore.load()?.agents ?? []
    let usable = all.filter { $0.available }
    StartThreadIntent.debugLog(
      "agentQuery.usable total=\(all.count) available=\(usable.count) ids=\(usable.map(\.id))"
    )
    return usable
  }

  func entities(for identifiers: [String]) async throws -> [AgentEntity] {
    StartThreadIntent.debugLog("agentQuery.entities identifiers=\(identifiers)")
    let result = usableAgents().filter { identifiers.contains($0.id) }.map {
      AgentEntity(id: $0.id, name: $0.displayName, available: $0.available)
    }
    StartThreadIntent.debugLog("agentQuery.entities resolved=\(result.map(\.id))")
    return result
  }

  func suggestedEntities() async throws -> [AgentEntity] {
    StartThreadIntent.debugLog("agentQuery.suggested begin")
    return try await allEntities()
  }

  func allEntities() async throws -> [AgentEntity] {
    StartThreadIntent.debugLog("agentQuery.all begin")
    let result = usableAgents().map {
      AgentEntity(id: $0.id, name: $0.displayName, available: $0.available)
    }
    StartThreadIntent.debugLog("agentQuery.all resultCount=\(result.count)")
    return result
  }

  func entities(matching string: String) async throws -> [AgentEntity] {
    StartThreadIntent.debugLog("agentQuery.match begin inputLen=\(string.count)")
    let result = usableAgents().filter { $0.displayName.localizedCaseInsensitiveContains(string) }.map {
      AgentEntity(id: $0.id, name: $0.displayName, available: $0.available)
    }
    StartThreadIntent.debugLog("agentQuery.match resultCount=\(result.count)")
    return result
  }
}

enum SiriRequestError: Error, CustomLocalizedStringResourceConvertible {
  case encodingFailed
  case stagingFailed
  case agentUnavailable(String)

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .encodingFailed: return "Couldn't prepare the thread request."
    case .stagingFailed: return "Couldn't save the thread request. Please try again."
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
  // NOTE (ad-hoc debugging): openAppWhenRun=true requires the system to
  // resolve the containing host app, which fails for ad-hoc-signed builds
  // and aborts the run before perform(). Disabled until proven otherwise;
  // Electron already consumes staged requests on next activation/startup.
  static var openAppWhenRun: Bool = false

  static func debugLog(_ message: String) {
    SiriDiagnostics.log(message)
  }

  @Parameter(title: "Project" , description: "name of the project to run the agent in") var project: ProjectEntity
  @Parameter(title: "Agent" , description: "the agent to run") var agent: AgentEntity
  @Parameter(title: "Task",description: "what action or a task in perform in a project with an agent", requestValueDialog: "What should the thread work on?") var prompt: String?

  func perform() async throws -> some IntentResult & ProvidesDialog {
    Self.debugLog("perform entered")
    Self.debugLog("perform start projectId=\(project.id) agentId=\(agent.id) promptLen=\(prompt?.count ?? 0)")
    Self.debugLog("candidateDirs=\(SiriCatalogStore.candidateDirs().map { $0.path })")
    let catalog = SiriCatalogStore.load()
    Self.debugLog("catalog loaded: projects=\(catalog?.projects.count ?? -1) agents=\(catalog?.agents.count ?? -1)")
    // Revalidate availability at run time: the catalog may have changed
    // between entity resolution and perform().
    let usableIds = Set((catalog?.agents ?? []).filter { $0.available }.map { $0.id })
    let chosenAgent = agent
    guard usableIds.contains(chosenAgent.id) else {
      Self.debugLog("perform rejected agentId=\(chosenAgent.id) reason=unavailable")
      throw SiriRequestError.agentUnavailable(chosenAgent.name)
    }
    let resolvedAgentId = chosenAgent.id
    Self.debugLog("perform validation passed agentId=\(resolvedAgentId)")
    if SiriCatalogStore.isPreviewExtension {
      return .result(
        dialog: "Preview: would start a thread in \(project.name)."
      )
    }
    // Stage a pending request. The host app is opened automatically after the
    // intent completes and Electron consumes this file during activation.
    let requestId = UUID().uuidString
    let payload: [String: String] = [
      "requestId": requestId,
      "projectId": project.id,
      "agentId": resolvedAgentId,
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
    return .result(
      dialog: "Starting a thread in \(project.name)."
    )
  }
}

// MARK: - Entity parameter probe (no staging)

struct CheckPipperParametersIntent: AppIntent {
  static var title: LocalizedStringResource = "Check Pipper parameters"
  static var description = IntentDescription(
    "Diagnostic action that verifies Project and Agent parameters without creating a thread.",
    categoryName: "Productivity"
  )
  static var isDiscoverable: Bool = true
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Project", description: "the project to inspect") var project: ProjectEntity
  @Parameter(title: "Agent", description: "the agent to inspect") var agent: AgentEntity
  @Parameter(title: "Task") var prompt: String?

  func perform() async throws -> some IntentResult & ProvidesDialog {
    StartThreadIntent.debugLog(
      "parameterProbe perform projectId=\(project.id) agentId=\(agent.id) promptLen=\(prompt?.count ?? 0)"
    )
    return .result(
      dialog: "Parameters resolved for \(project.name) with \(agent.name)."
    )
  }
}

// MARK: - Primitive parameter probe (bypasses AppEntity conversion)

struct CheckPipperIDsIntent: AppIntent {
  static var title: LocalizedStringResource = "Check Pipper IDs"
  static var description = IntentDescription(
    "Diagnostic action that verifies primitive Project and Agent IDs without creating a thread.",
    categoryName: "Productivity"
  )
  static var isDiscoverable: Bool = true
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Project ID", description: "the project identifier to inspect") var projectId: String
  @Parameter(title: "Agent ID", description: "the agent identifier to inspect") var agentId: String
  @Parameter(title: "Task") var prompt: String?

  func perform() async throws -> some IntentResult & ProvidesDialog {
    StartThreadIntent.debugLog(
      "idProbe perform projectId=\(projectId) agentId=\(agentId) promptLen=\(prompt?.count ?? 0)"
    )
    return .result(
      dialog: "Primitive IDs received for project \(projectId) and agent \(agentId)."
    )
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
