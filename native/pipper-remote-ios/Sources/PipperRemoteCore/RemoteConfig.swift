import Foundation

/// Where the laptop is and how to authenticate. The host must be a Tailscale
/// (100.64/10) or loopback address — that is all the laptop's RemoteServer
/// binds, and the only place a bearer token may travel in cleartext.
public struct RemoteConfig: Codable, Equatable, Sendable {
  public static let defaultPort = 4173

  public var host: String
  public var port: Int
  public var token: String

  public init(host: String, port: Int = RemoteConfig.defaultPort, token: String) {
    self.host = host.trimmingCharacters(in: .whitespacesAndNewlines)
    self.port = port
    self.token = token.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  public var baseURL: URL? {
    var c = URLComponents()
    c.scheme = "http"
    c.host = host
    c.port = port
    return c.url
  }

  public var isComplete: Bool {
    !host.isEmpty && !token.isEmpty && baseURL != nil
  }
}

public enum PairingURL {
  /// Parses the laptop's pairing QR, `http://<host>:<port>/remote#token=<hex>`.
  /// Returns nil for anything that is not that exact shape.
  public static func parse(_ text: String) -> RemoteConfig? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let components = URLComponents(string: trimmed),
      components.scheme == "http",
      let host = components.host, !host.isEmpty
    else { return nil }
    let fragment = components.fragment ?? ""
    guard let range = fragment.range(of: #"token=([A-Za-z0-9]+)"#, options: .regularExpression)
    else { return nil }
    let token = String(fragment[range].dropFirst("token=".count))
    return RemoteConfig(host: host, port: components.port ?? RemoteConfig.defaultPort, token: token)
  }

  /// Tolerant host parsing for the manual form: accepts `100.1.2.3`,
  /// `100.1.2.3:4173`, `http://100.1.2.3:4173/remote…`, or the full pairing
  /// URL. Returns the host and, when present, the port (and token).
  public static func parseHostInput(_ text: String) -> (host: String, port: Int?, token: String?)? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    if trimmed.contains("://") {
      guard let c = URLComponents(string: trimmed), let host = c.host, !host.isEmpty else { return nil }
      let token = parse(trimmed)?.token
      return (host, c.port, token)
    }
    // "host" or "host:port" (IPv4 / hostname only; IPv6 needs the URL form).
    let parts = trimmed.split(separator: ":", maxSplits: 1).map(String.init)
    guard let host = parts.first, !host.isEmpty, !host.contains("/") else { return nil }
    if parts.count == 2 {
      guard let port = Int(parts[1]), (1...65535).contains(port) else { return nil }
      return (host, port, nil)
    }
    return (host, nil, nil)
  }

  /// A bare token pasted from the laptop terminal (hex, no URL).
  public static func isBareToken(_ text: String) -> Bool {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return !t.isEmpty && t.range(of: #"^[A-Za-z0-9]+$"#, options: .regularExpression) != nil
  }
}
