import AppIntents
import SwiftUI

@main
struct PipperRemoteApp: App {
  @State private var session = RemoteSession.shared
  @Environment(\.scenePhase) private var scenePhase

  init() {
    // Register phrases + entity names with Siri as early as possible so a
    // "Start a Pipper thread in X" works before the UI is ever opened.
    PipperRemoteShortcuts.updateAppShortcutParameters()
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(session)
        .task { await session.refreshCatalogIfStale() }
        .onChange(of: scenePhase) { _, phase in
          if phase == .active { Task { await session.refreshCatalogIfStale() } }
        }
    }
  }
}

struct RootView: View {
  @Environment(RemoteSession.self) private var session

  var body: some View {
    if session.isPaired {
      ThreadListView()
    } else {
      PairingView()
    }
  }
}
