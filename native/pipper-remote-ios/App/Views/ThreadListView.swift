import AppIntents
import SwiftUI

/// Home: one project's threads on the Mac (polled) as a staggered card grid.
/// The large title is the project picker. Siri-created threads are opened
/// automatically on next foreground.
struct ThreadListView: View {
  @Environment(RemoteSession.self) private var session
  @Environment(\.scenePhase) private var scenePhase
  @State private var threads: [RemoteThreadSummary] = []
  @State private var loadError: String?
  @State private var path: [String] = []
  /// "" until chosen; then falls back to the most recently active project.
  @AppStorage("home.projectId") private var storedProjectId = ""

  #if DEBUG
  /// Preview-only seed so the grid is shown populated; the default `[]`
  /// keeps the production call site (`ThreadListView()`) unchanged.
  init(previewThreads: [RemoteThreadSummary] = []) {
    _threads = State(initialValue: previewThreads)
  }
  #endif

  var body: some View {
    NavigationStack(path: $path) {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          HStack(alignment: .center) {
              ProfileAvatar()
            Spacer(minLength: 12)
          
              projectMenu
          }
          if let loadError {
            Text(loadError).foregroundStyle(.red).font(.footnote)
          }
          if visibleThreads.isEmpty && loadError == nil {
            ContentUnavailableView {
              Label("No threads yet", systemImage: "bubble.left.and.text.bubble.right")
            } description: {
              Text("Ask Siri: “Start a Pipper thread in \(selectedProjectName ?? "your project")”, or tap +.")
            }
            .padding(.top, 40)
          } else {
            ThreadGrid(threads: visibleThreads)
          }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 24)
      }
      // The project menu in the content is the title; keep the bar empty.
      .navigationTitle("")
      .navigationBarTitleDisplayMode(.inline)
      .navigationDestination(for: String.self) { id in
        // Reading a thread is full-screen: the composer owns the bottom edge.
        ThreadDetailView(threadId: id)
          .toolbar(.hidden, for: .tabBar)
      }
      .refreshable { await load() }
      .task(id: scenePhase == .active) { if scenePhase == .active { await poll() } }
      .onAppear { openSiriThreadIfAny() }
      .onChange(of: session.lastSiriThreadId) { _, _ in openSiriThreadIfAny() }
      // Siri may have run while the app sat in the background; land on the
      // thread it created the next time the app comes forward.
      .onChange(of: scenePhase) { _, phase in
        if phase == .active { openSiriThreadIfAny() }
      }
    }
  }

  /// Large project name with an up/down chevron; tapping switches project.
  private var projectMenu: some View {
    Menu {
      Picker("Project", selection: projectBinding) {
        ForEach(projectChoices, id: \.id) { p in
          Text(p.name).tag(p.id)
        }
      }
    } label: {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(selectedProjectName ?? "Pipper")
          .font(.largeTitle.bold())
          .fontDesign(.rounded)
          .lineLimit(1)
        Image(systemName: "chevron.up.chevron.down")
          .font(.title3.weight(.semibold))
          .foregroundStyle(.secondary)
      }
      .foregroundStyle(.primary)
    }
    .tint(.primary)
    .disabled(projectChoices.count < 2)
    .padding(.top, 4)
  }

  /// Newest first; the Mac's order isn't guaranteed to be by recency.
  private var sortedThreads: [RemoteThreadSummary] {
    threads.sorted { $0.lastUsedAt > $1.lastUsedAt }
  }

  /// Catalog projects, plus any project a thread references that the catalog
  /// doesn't list yet, ordered by most recent activity.
  private var projectChoices: [(id: String, name: String)] {
    var ids: [String] = []
    for t in sortedThreads where !ids.contains(t.projectId) { ids.append(t.projectId) }
    for p in session.catalog.projects where !ids.contains(p.id) { ids.append(p.id) }
    return ids.map { ($0, session.catalog.project(id: $0)?.name ?? $0) }
  }

  /// The stored choice while it still exists, else the most active project.
  private var selectedProjectId: String? {
    if projectChoices.contains(where: { $0.id == storedProjectId }) { return storedProjectId }
    return projectChoices.first?.id
  }

  private var selectedProjectName: String? {
    selectedProjectId.flatMap { id in projectChoices.first { $0.id == id }?.name }
  }

  private var projectBinding: Binding<String> {
    Binding(get: { selectedProjectId ?? "" }, set: { storedProjectId = $0 })
  }

  private var visibleThreads: [RemoteThreadSummary] {
    sortedThreads.filter { $0.projectId == selectedProjectId }
  }

  private func openSiriThreadIfAny() {
    guard let id = session.lastSiriThreadId else { return }
    session.lastSiriThreadId = nil
    path = [id]
  }

  private func load() async {
    guard let client = session.client else { return }
    do {
      let next = try await client.listThreads()
      if next != threads { threads = next }
      loadError = nil
    } catch {
      loadError = error.localizedDescription
    }
  }

  private func poll() async {
    while !Task.isCancelled {
      await load()
      try? await Task.sleep(for: .seconds(5))
    }
  }
}

/// Signed-in user's avatar. Hardcoded until accounts exist.
private struct ProfileAvatar: View {
  private let initials = "HP"

  var body: some View {
    Text(initials)
      .font(.subheadline.weight(.semibold))
      .foregroundStyle(.white)
      .frame(width: 38, height: 38)
      .background(
        LinearGradient(colors: [.blue, .blue], startPoint: .topLeading, endPoint: .bottomTrailing),
        in: Circle())
      .accessibilityLabel("Profile")
  }
}

/// Two columns of equal cards; the right column starts lower so the grid
/// reads as staggered. Threads fill left, right, left… in recency order.
private struct ThreadGrid: View {
  let threads: [RemoteThreadSummary]
  private let spacing: CGFloat = 14

  var body: some View {
    HStack(alignment: .top, spacing: spacing) {
      column(stride(from: 0, to: threads.count, by: 2).map { threads[$0] })
      column(stride(from: 1, to: threads.count, by: 2).map { threads[$0] })
        .padding(.top, 36)
    }
  }

  private func column(_ items: [RemoteThreadSummary]) -> some View {
    VStack(spacing: spacing) {
      ForEach(items) { t in
        NavigationLink(value: t.id) { ThreadCard(thread: t) }
          .buttonStyle(.plain)
      }
    }
    .frame(maxWidth: .infinity, alignment: .top)
  }
}

private struct ThreadCard: View {
  let thread: RemoteThreadSummary

  var body: some View {
    VStack(spacing: 8) {
      Text(thread.title ?? String(thread.id.prefix(8)))
        .font(.headline)
        .fontDesign(.rounded)
        .multilineTextAlignment(.center)
        .lineLimit(5)
        .frame(maxWidth: .infinity)
      Spacer(minLength: 0)
      Text(subtitle)
        .font(.caption)
        .foregroundStyle(thread.running ? Color.green : Color.secondary)
        .multilineTextAlignment(.center)
        .lineLimit(2)
    }
    .padding(14)
    .frame(height: 200)
    .background(Color(.secondarySystemBackground), in: Self.shape)
    .contentShape(Self.shape)
  }

  /// One fixed radius. ConcentricRectangle resolves against the display
  /// corners, so in a scroll view cards would change shape as they pass the
  /// screen's rounded corners; scrolling content keeps a constant radius.
  private static let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)

  private var subtitle: String {
    var parts = [
      thread.running
        ? "Running"
        : Date(timeIntervalSince1970: thread.lastUsedAt / 1000).formatted(.relative(presentation: .named))
    ]
    if thread.worktreePath == nil { parts.append("project root") }
    return parts.joined(separator: " · ")
  }
}

/// Manual equivalent of the Siri intent: pick project + agent, type a task.
struct NewThreadSheet: View {
  @Environment(RemoteSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  let onCreated: (RemoteThreadSummary) -> Void
  /// Preselected project (the one shown on Home); nil picks the first.
  var initialProjectId: String? = nil
  /// Shown as a tab rather than a sheet: no Cancel, and the form resets
  /// after starting so the tab is ready for the next task.
  var inTab = false

  @State private var projectId = ""
  @State private var agentId = ""
  /// Model inside the agent; "" keeps the agent's default.
  @State private var model = ""
  @State private var prompt = ""
  var sampleTask = false
  @State private var sending = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Project", selection: $projectId) {
            Text("Choose…").tag("")
            ForEach(session.catalog.projects) { p in
              Text(p.name).tag(p.id)
            }
          }
          Picker("Agent", selection: $agentId) {
            Text("Mac default").tag("")
            ForEach(session.catalog.availableAgents) { a in
              Text(a.displayName).tag(a.id)
            }
          }
          if !models.isEmpty {
            Picker("Model", selection: $model) {
              Text("Agent default").tag("")
              ForEach(models) { m in
                Text(m.name).tag(m.id)
              }
            }
          } else if session.loadingAgentModels {
            LabeledContent("Model") { ProgressView().controlSize(.small) }
          } else {
            LabeledContent("Model", value: "Agent default")
          }
        } footer: {
          if !session.agentModelsSupported {
            Text("Update Pipper on your Mac to choose a model.")
          } else if let modelError = session.agentModelsError, models.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
              Text("Couldn't load models: \(modelError)")
              Button("Retry") { Task { await session.refreshAgentModels() } }
                .font(.footnote)
            }
          }
        }
        .onChange(of: agentId) { _, _ in model = "" }
        Section("Task") {
          TextField("What should the agent do?", text: $prompt, axis: .vertical)
            .lineLimit(3...8)
        }
        if let error {
          Section { Text(error).foregroundStyle(.red) }
        }
        if session.catalog.projects.isEmpty {
          Section {
            Text(session.catalogError ?? "No projects loaded from the Mac yet.")
              .foregroundStyle(.secondary)
            Button("Refresh catalog") { Task { await session.refreshCatalog() } }
          }
        }
      }
      .navigationTitle(sampleTask ? "Sample task" : "New thread")
      .navigationBarTitleDisplayMode(.inline)
      .interactiveDismissDisabled(sending)
      .toolbar {
        if !inTab {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { dismiss() }.disabled(sending)
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Start") { Task { await start() } }
            .disabled(projectId.isEmpty || prompt.trimmingCharacters(in: .whitespaces).isEmpty || sending)
        }
      }
      .task {
        if sampleTask && prompt.isEmpty {
          prompt = "Describe this project's purpose in one sentence. Do not change files or run commands."
        }
        await session.refreshCatalogIfStale()
        if projectId.isEmpty {
          if let initialProjectId, session.catalog.project(id: initialProjectId) != nil {
            projectId = initialProjectId
          } else if let first = session.catalog.projects.first {
            projectId = first.id
          }
        }
        await session.refreshAgentModels()
      }
    }
  }

  private var effectiveAgentId: String? {
    agentId.isEmpty ? session.catalog.preferredAgent?.id : agentId
  }

  private var models: [RemoteAgentModel] {
    effectiveAgentId.flatMap { session.agentModels[$0] } ?? []
  }

  private func start() async {
    guard session.isPaired, !sending else { return }
    sending = true
    defer { sending = false }
    error = nil
    do {
      let thread = try await session.createThread(
        projectId: projectId,
        agentId: effectiveAgentId,
        model: model.isEmpty ? nil : model,
        prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines))
      if inTab { prompt = "" }
      onCreated(thread)
    } catch {
      self.error = error.localizedDescription
    }
  }
}

#if DEBUG
#Preview("Threads") {
  ThreadListView(previewThreads: PreviewData.threads)
    .environment(RemoteSession.preview(catalog: PreviewData.catalog))
}

#Preview("Threads — empty") {
  ThreadListView()
    .environment(RemoteSession.preview(catalog: PreviewData.catalog))
}

#Preview("New thread") {
  NewThreadSheet { _ in }
    .environment(RemoteSession.preview(catalog: PreviewData.catalog, agentModels: PreviewData.agentModels))
}
#endif
