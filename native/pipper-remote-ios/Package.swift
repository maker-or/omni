// swift-tools-version: 6.0
import PackageDescription

// `swift test` here validates the Foundation-only core (catalog, HTTP client,
// pairing URL parsing) on the Mac. The iOS app in PipperRemote.xcodeproj
// compiles these same sources directly, mirroring native/pipper-intents.
let package = Package(
  name: "PipperRemoteCore",
  platforms: [.iOS(.v18), .macOS(.v13)],
  products: [
    .library(name: "PipperRemoteCore", targets: ["PipperRemoteCore"]),
  ],
  targets: [
    .target(name: "PipperRemoteCore", path: "Sources/PipperRemoteCore"),
    .testTarget(
      name: "PipperRemoteCoreTests",
      dependencies: ["PipperRemoteCore"],
      path: "Tests/PipperRemoteCoreTests"
    ),
  ]
)
