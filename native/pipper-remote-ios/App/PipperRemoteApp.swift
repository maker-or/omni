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
      MainTabView()
    } else {
      PairingView()
    }
  }
}

/// Paired shell: Threads and Settings, with New split off as its own
/// trailing "+" button (the tab bar's separated search-role slot).
struct MainTabView: View {
  @Environment(RemoteSession.self) private var session
  enum TabID: Hashable { case threads, new, settings }
  @State private var tab: TabID = .threads
  /// Same key Home uses for its selected project.
  @AppStorage("home.projectId") private var homeProjectId = ""

  /// iOS 27's prominent role is the separated trailing action; on earlier
  /// systems the search role gets the same split-off placement.
  /// Drawn rather than palette-tinted so the tab bar can't recolor it.
  private static let newTabIcon: UIImage = {
    let size = CGSize(width: 34, height: 34)
    let image = UIGraphicsImageRenderer(size: size).image { _ in
      UIColor.systemIndigo.setFill()
      UIBezierPath(ovalIn: CGRect(origin: .zero, size: size)).fill()
      let plus = UIImage(
        systemName: "plus",
        withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .bold))?
        .withTintColor(.white, renderingMode: .alwaysOriginal)
      if let plus {
        plus.draw(at: CGPoint(x: (size.width - plus.size.width) / 2, y: (size.height - plus.size.height) / 2))
      }
    }
    return image.withRenderingMode(.alwaysOriginal)
  }()

  private static var newTabRole: TabRole {
    if #available(iOS 27.0, *) { return .prominent }
    return .search
  }

  var body: some View {
    TabView(selection: $tab) {
      Tab("Threads", systemImage: "square.grid.2x2", value: TabID.threads) {
        ThreadListView()
      }
      Tab("Settings", systemImage: "gearshape", value: TabID.settings) {
        SettingsView(inTab: true)
      }
      Tab(value: TabID.new, role: Self.newTabRole) {
        NewThreadSheet(
          onCreated: { thread in
            // Home opens this thread via the same hand-off Siri uses.
            homeProjectId = thread.projectId
            session.lastSiriThreadId = thread.id
            tab = .threads
          },
          initialProjectId: homeProjectId.isEmpty ? nil : homeProjectId,
          inTab: true)
      } label: {
        // Tab bars template-render SF Symbols; a pre-colored image keeps the
        // filled indigo circle so the action stands out.
        Label {
          Text("New")
        } icon: {
          Image(uiImage: Self.newTabIcon)
        }
      }
    }
    // Colors the prominent "+" and the selected tab.
    .tint(.indigo)
  }
}

#if DEBUG
#Preview("Root — unpaired") {
  RootView()
    .environment(RemoteSession.preview())
}

#Preview("Root — paired") {
  RootView()
    .environment(RemoteSession.preview(catalog: PreviewData.catalog, paired: true))
}
#endif
