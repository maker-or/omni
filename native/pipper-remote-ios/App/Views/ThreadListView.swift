import AppIntents
import SwiftUI

/// Home: recent threads on the Mac (polled), plus a composer for new work.
/// Siri-created threads are opened automatically on next foreground.
struct ThreadListView: View {
  @Environment(RemoteSession.self) private var session
  @Environment(\.scenePhase) private var scenePhase
  @State private var threads: [RemoteThreadSummary] = []
  @State private var loadError: String?
  @State private var showNew = false
  @State private var showSettings = false
  @State private var path: [String] = []

  var body: some View {
    NavigationStack(path: $path) {
      List {
        if let loadError {
          Text(loadError).foregroundStyle(.red).font(.footnote)
        }
        if threads.isEmpty && loadError == nil {
          ContentUnavailableView {
            Label("No threads yet", systemImage: "bubble.left.and.text.bubble.right")
          } description: {
            Text("Ask Siri: “Start a Pipper thread in \(session.catalog.projects.first?.name ?? "your project")”, or tap +.")
          }
        }
        ForEach(threads) { t in
          NavigationLink(value: t.id) {
            ThreadRow(thread: t, projectName: session.catalog.project(id: t.projectId)?.name)
          }
        }
        Section {
          SiriTipView(intent: StartThreadIntent())
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
      }
      .navigationTitle("Pipper")
      .navigationDestination(for: String.self) { id in
        ThreadDetailView(threadId: id)
      }
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button { showSettings = true } label: { Image(systemName: "gearshape") }
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button { showNew = true } label: { Image(systemName: "plus") }
        }
      }
      .sheet(isPresented: $showNew) {
        NewThreadSheet { created in
          showNew = false
          threads.insert(created, at: 0)
          path = [created.id]
        }
      }
      .sheet(isPresented: $showSettings) {
        SettingsView()
      }
      .refreshable { await load() }
      .task { await poll() }
      .onAppear { openSiriThreadIfAny() }
      // Siri may have run while the app sat in the background; land on the
      // thread it created the next time the app comes forward.
      .onChange(of: scenePhase) { _, phase in
        if phase == .active { openSiriThreadIfAny() }
      }
    }
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

private struct ThreadRow: View {
  let thread: RemoteThreadSummary
  let projectName: String?

  var body: some View {
    HStack(spacing: 10) {
      Circle()
        .fill(thread.running ? Color.green : Color.secondary.opacity(0.4))
        .frame(width: 8, height: 8)
      VStack(alignment: .leading, spacing: 2) {
        Text(thread.title ?? String(thread.id.prefix(8)))
          .lineLimit(1)
        HStack(spacing: 6) {
          if let projectName { Text(projectName) }
          if thread.worktreePath == nil { Text("· project root") }
          Text(thread.running ? "· running" : "")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
      }
    }
  }
}

/// Manual equivalent of the Siri intent: pick project + agent, type a task.
struct NewThreadSheet: View {
  @Environment(RemoteSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  let onCreated: (RemoteThreadSummary) -> Void

  @State private var projectId = ""
  @State private var agentId = ""
  @State private var prompt = ""
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
        }
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
      .navigationTitle("New thread")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Start") { Task { await start() } }
            .disabled(projectId.isEmpty || prompt.trimmingCharacters(in: .whitespaces).isEmpty || sending)
        }
      }
      .task {
        await session.refreshCatalogIfStale()
        if projectId.isEmpty, let first = session.catalog.projects.first { projectId = first.id }
      }
    }
  }

  private func start() async {
    guard let client = session.client else { return }
    sending = true
    defer { sending = false }
    error = nil
    do {
      let thread = try await client.createThread(
        projectId: projectId,
        agentId: agentId.isEmpty ? session.catalog.preferredAgent?.id : agentId,
        prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines))
      onCreated(thread)
    } catch {
      self.error = error.localizedDescription
    }
  }
}
