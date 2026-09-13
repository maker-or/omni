import Foundation

/// On-disk cache of the laptop catalog. Siri parameter resolution reads this
/// (fast, offline-safe); the app and intents refresh it opportunistically.
public struct CatalogStore: Sendable {
  public let fileURL: URL

  public init(fileURL: URL) {
    self.fileURL = fileURL
  }

  /// `<Application Support>/PipperRemote/siri-catalog.json` in the app's own
  /// container. Intents run in-process, so no App Group is needed.
  public static func standard() -> CatalogStore {
    let base =
      FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    return CatalogStore(
      fileURL: base.appendingPathComponent("PipperRemote", isDirectory: true)
        .appendingPathComponent("siri-catalog.json"))
  }

  public func load() -> RemoteCatalog? {
    guard let data = try? Data(contentsOf: fileURL) else { return nil }
    return try? JSONDecoder().decode(RemoteCatalog.self, from: data)
  }

  public func save(_ catalog: RemoteCatalog) throws {
    try FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    let data = try JSONEncoder().encode(catalog)
    try data.write(to: fileURL, options: .atomic)
  }

  public func clear() {
    try? FileManager.default.removeItem(at: fileURL)
  }

  /// When the cache was last written, for staleness checks.
  public var modifiedAt: Date? {
    (try? FileManager.default.attributesOfItem(atPath: fileURL.path))?[.modificationDate] as? Date
  }
}
