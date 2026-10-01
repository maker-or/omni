import AppIntents
import SwiftUI

struct SettingsView: View {
  @Environment(RemoteSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var refreshing = false

  var body: some View {
    NavigationStack {
      Form {
        Section("Mac") {
          LabeledContent("Host", value: session.config?.host ?? "—")
          LabeledContent("Port", value: session.config.map { String($0.port) } ?? "—")
        }
        ConnectionCheckView()
        Section {
          Button {
            Task {
              refreshing = true
              await session.refreshCatalog()
              refreshing = false
            }
          } label: {
            HStack {
              Text("Refresh catalog")
              Spacer()
              if refreshing { ProgressView() }
            }
          }
          if let err = session.catalogError {
            Text(err).font(.footnote).foregroundStyle(.red)
          }
          if let last = session.lastCatalogRefresh {
            LabeledContent("Updated", value: last.formatted(date: .abbreviated, time: .shortened))
          }
        } header: {
          Text("Siri catalog")
        } footer: {
          Text("Siri resolves project and agent names from this cached list, so it works even when the Mac is asleep. It refreshes automatically when the app opens.")
        }
        Section("Projects (\(session.catalog.projects.count))") {
          ForEach(session.catalog.projects) { p in
            VStack(alignment: .leading) {
              Text(p.name)
              Text(p.path).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
          }
        }
        Section("Agents") {
          ForEach(session.catalog.agents) { a in
            HStack {
              Text(a.displayName)
              if a.id == session.catalog.defaultAgentId {
                Text("default").font(.caption).foregroundStyle(.secondary)
              }
              Spacer()
              Text(a.available ? "available" : "not installed")
                .font(.caption)
                .foregroundStyle(a.available ? .green : .secondary)
            }
          }
        }
        Section("Siri") {
          ShortcutsLink()
          Text("Try: “Start a Pipper thread in \(session.catalog.projects.first?.name ?? "FolkLore") with \(session.catalog.preferredAgent?.displayName ?? "Codex")”")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        Section {
          Button("Unpair", role: .destructive) {
            session.unpair()
            dismiss()
          }
        }
      }
      .navigationTitle("Settings")
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
    }
  }

 }

/// Shared by setup and settings; authentication is checked by diagnostics,
/// unlike the public reachability endpoint.
struct ConnectionCheckView: View {
  @Environment(RemoteSession.self) private var session
  @State private var diagnostics: RemoteDiagnostics?
  @State private var error: String?
  @State private var checking = false
  @State private var checkedAt: Date?
  @State private var showSample = false

  var body: some View {
    Section("Connection checks") {
      // Modifiers on a Section inside a List/Form are applied to every row,
      // which would register one sheet (and one task) per row. Anchor them to
      // this always-present row instead.
      Button(checking ? "Checking…" : "Test connection") { Task { await check() } }
        .disabled(checking)
        .task { await check() }
        .sheet(isPresented: $showSample) {
          NewThreadSheet(onCreated: { thread in
            session.lastSiriThreadId = thread.id
            showSample = false
          }, sampleTask: true)
        }
      if let error {
        Text(error).font(.footnote).foregroundStyle(.red)
        Text("Keep Pipper open on the Mac and connect both devices to the same Tailscale network.")
          .font(.footnote).foregroundStyle(.secondary)
      }
      if let diagnostics {
        Label("Mac reachable · pairing accepted", systemImage: "checkmark.circle")
        Label(diagnostics.agentReady ? "Pipper is ready" : "Pipper is starting",
          systemImage: diagnostics.agentReady ? "checkmark.circle" : "clock")
        Text("\(diagnostics.availableAgents) available agents · \(diagnostics.projects) projects")
        Text(diagnostics.guidance).font(.footnote).foregroundStyle(.secondary)
        Button("Run a sample task") { showSample = true }
          .disabled(!diagnostics.ready || error != nil || checking)
      }
      if let checkedAt {
        Text("Last checked \(checkedAt.formatted(date: .omitted, time: .standard))")
          .font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private func check() async {
    guard let client = session.client, !checking else { return }
    checking = true
    error = nil
    defer { checking = false }
    do {
      diagnostics = try await client.diagnostics()
      checkedAt = Date()
      await session.refreshCatalog()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

#if DEBUG
#Preview("Settings") {
  SettingsView()
    .environment(RemoteSession.preview(catalog: PreviewData.catalog))
}

#Preview("Connection check") {
  Form {
    ConnectionCheckView()
  }
  .environment(RemoteSession.preview(catalog: PreviewData.catalog))
}
#endif
