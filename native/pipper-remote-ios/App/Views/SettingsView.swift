import AppIntents
import SwiftUI

struct SettingsView: View {
  @Environment(RemoteSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var refreshing = false
  @State private var reachable: Bool?

  var body: some View {
    NavigationStack {
      Form {
        Section("Mac") {
          LabeledContent("Host", value: session.config?.host ?? "—")
          LabeledContent("Port", value: session.config.map { String($0.port) } ?? "—")
          Button("Test connection") { Task { await test() } }
          if let reachable {
            Label(
              reachable ? "Reachable" : "Not reachable",
              systemImage: reachable ? "checkmark.circle.fill" : "xmark.circle.fill")
            .foregroundStyle(reachable ? .green : .red)
          }
        }
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

  private func test() async {
    guard let client = session.client else { return }
    reachable = (try? await client.health()) ?? false
  }
}
