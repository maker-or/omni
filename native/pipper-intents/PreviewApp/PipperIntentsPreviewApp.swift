import SwiftUI

/// Minimal macOS host used to make the package's App Shortcuts visible to
/// Xcode's Product > App Shortcuts Preview.
@main
struct PipperIntentsPreviewApp: App {
  var body: some Scene {
    WindowGroup("Pipper App Shortcuts Preview") {
      VStack(spacing: 12) {
        Text("Pipper App Shortcuts")
          .font(.title2)
        Text("Build this host, then open Product > App Shortcuts Preview.")
          .foregroundStyle(.secondary)
      }
      .padding(32)
      .frame(minWidth: 420, minHeight: 180)
    }
  }
}
