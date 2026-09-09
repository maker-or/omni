import AppIntents
import Foundation

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
    for dir in candidateDirs() {
      let url = dir.appendingPathComponent("siri-catalog.json")
      if let data = try? Data(contentsOf: url),
        let catalog = try? JSONDecoder().decode(SiriCatalog.self, from: data)
      {
        return catalog
      }
    }
    guard isPreviewExtension else { return nil }
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

struct ProjectEntity: AppEntity, Sendable {
  var id: String
  @Property(title: "Name") var name: String
  @Property(title: "Path") var path: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Project"
  static var defaultQuery = ProjectEntityQuery()

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
    let all = SiriCatalogStore.load()?.projects ?? []
    return all.filter { identifiers.contains($0.id) }.map {
      ProjectEntity(id: $0.id, name: $0.name, path: $0.path)
    }
  }

  func suggestedEntities() async throws -> [ProjectEntity] {
    try await allEntities()
  }

  func allEntities() async throws -> [ProjectEntity] {
    let all = SiriCatalogStore.load()?.projects ?? []
    return all.map { ProjectEntity(id: $0.id, name: $0.name, path: $0.path) }
  }

  func entities(matching string: String) async throws -> [ProjectEntity] {
    let all = SiriCatalogStore.load()?.projects ?? []
    return all.filter {
      $0.name.localizedCaseInsensitiveContains(string)
        || $0.path.localizedCaseInsensitiveContains(string)
    }.map { ProjectEntity(id: $0.id, name: $0.name, path: $0.path) }
  }
}

struct AgentEntity: AppEntity, Sendable {
  var id: String
  @Property(title: "Name") var name: String
  @Property(title: "Available") var available: Bool

  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Agent"
  static var defaultQuery = AgentEntityQuery()

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)")
  }

  init(id: String, name: String, available: Bool) {
    self.id = id
    self.name = name
    self.available = available
  }
}

struct AgentEntityQuery: EnumerableEntityQuery, EntityStringQuery {
  /// Only usable agents are ever offered — staging a thread for a missing
  /// CLI would fail later in Electron.
  private func usableAgents() -> [SiriCatalogAgent] {
    (SiriCatalogStore.load()?.agents ?? []).filter { $0.available }
  }

  func entities(for identifiers: [String]) async throws -> [AgentEntity] {
    usableAgents().filter { identifiers.contains($0.id) }.map {
      AgentEntity(id: $0.id, name: $0.displayName, available: $0.available)
    }
  }

  func suggestedEntities() async throws -> [AgentEntity] {
    try await allEntities()
  }

  func allEntities() async throws -> [AgentEntity] {
    usableAgents().map {
      AgentEntity(id: $0.id, name: $0.displayName, available: $0.available)
    }
  }

  func entities(matching string: String) async throws -> [AgentEntity] {
    usableAgents().filter { $0.displayName.localizedCaseInsensitiveContains(string) }.map {
      AgentEntity(id: $0.id, name: $0.displayName, available: $0.available)
    }
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
  // macOS opens the host app after perform() returns when this is true;
  // Electron then consumes the staged request during activation/startup.
  static var openAppWhenRun: Bool = true

  private static func debugLog(_ message: String) {
    let line = "[PipperIntents] \(message)\n"
    if let data = line.data(using: .utf8) {
      let url = URL(fileURLWithPath: "/tmp/pipper-intents-debug.log")
      if FileManager.default.fileExists(atPath: url.path) {
        if let handle = try? FileHandle(forWritingTo: url) {
          handle.seekToEndOfFile()
          handle.write(data)
          try? handle.close()
        }
      } else {
        try? data.write(to: url, options: .atomic)
      }
    }
  }

  @Parameter(title: "Project" , description: "name of the project to run the agent in") var project: ProjectEntity
  @Parameter(title: "Agent" , description: "the agent to run") var agent: AgentEntity?
  @Parameter(title: "Task",description: "what action or a task in perform in a project with an agent", requestValueDialog: "What should the thread work on?") var prompt: String?

  func perform() async throws -> some IntentResult & ProvidesDialog {
    Self.debugLog("perform start projectId=\(project.id) agentId=\(agent?.id ?? "nil") promptLen=\(prompt?.count ?? 0)")
    Self.debugLog("candidateDirs=\(SiriCatalogStore.candidateDirs().map { $0.path })")
    let catalog = SiriCatalogStore.load()
    Self.debugLog("catalog loaded: projects=\(catalog?.projects.count ?? -1) agents=\(catalog?.agents.count ?? -1)")
    // Revalidate availability at run time: the catalog may have changed
    // between entity resolution and perform().
    let usableIds = Set((catalog?.agents ?? []).filter { $0.available }.map { $0.id })
    let defaultId = catalog?.defaultAgentId
    let resolvedAgentId: String?
    if let chosen = agent {
      guard usableIds.contains(chosen.id) else {
        throw SiriRequestError.agentUnavailable(chosen.name)
      }
      resolvedAgentId = chosen.id
    } else {
      resolvedAgentId = defaultId.flatMap { usableIds.contains($0) ? $0 : nil }
    }
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
      "agentId": resolvedAgentId ?? "",
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
