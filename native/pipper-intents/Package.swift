// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "PipperIntents",
  platforms: [.macOS(.v13)],
  products: [
    .library(name: "PipperIntents", targets: ["PipperIntents"]),
  ],
  targets: [
    .target(name: "PipperIntents", path: "Sources"),
  ]
)
