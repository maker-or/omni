import CryptoKit
import Foundation

/// Account that pipper.dev says owns a laptop (from its signed statement).
public struct LaptopOwner: Codable, Equatable, Sendable {
  public var sub: String
  public var email: String?
  public var name: String?

  public init(sub: String, email: String?, name: String?) {
    self.sub = sub
    self.email = email
    self.name = name
  }

  public var label: String { email ?? name ?? "a Pipper account" }
}

/// The paired laptop: where its `/api/remote/*` lives and this phone's own
/// device token (issued by the laptop for a one-time pairing code).
public struct RemoteConfig: Codable, Equatable, Sendable {
  /// Origin of the laptop's API, e.g. `https://lt-ab12….pipper.dev`.
  public var baseURL: URL
  public var token: String
  /// What the laptop calls itself (unverified).
  public var laptopName: String?
  /// Owner verified at pairing time; nil when unverified.
  public var owner: LaptopOwner?
  /// The name this phone has in the laptop's device list.
  public var deviceName: String?

  public init(
    baseURL: URL, token: String, laptopName: String? = nil, owner: LaptopOwner? = nil,
    deviceName: String? = nil
  ) {
    self.baseURL = baseURL
    self.token = token.trimmingCharacters(in: .whitespacesAndNewlines)
    self.laptopName = laptopName
    self.owner = owner
    self.deviceName = deviceName
  }

  /// Host (and port, when not the scheme's default) for display and keys.
  public var address: String {
    guard let host = baseURL.host else { return baseURL.absoluteString }
    return baseURL.port.map { "\(host):\($0)" } ?? host
  }

  public var isComplete: Bool { !token.isEmpty && baseURL.host?.isEmpty == false }

  /// "MacBook Pro · me@example.com": verified owner when there is one.
  public var label: String {
    let name = laptopName ?? "Your Mac"
    return owner.map { "\(name) · \($0.label)" } ?? name
  }
}

/// A pairing offer from the laptop's QR or link, before it is redeemed. The
/// laptop shows it in Settings → Remote as a one-time code plus a link:
/// - named tunnel (Cloudflare): `https://remote.pipper.dev/#pair=CODE&host=lt-….pipper.dev`
/// - laptop-served (quick tunnel or Tailscale): `<laptop origin>/remote#pair=CODE`
public struct PairingLink: Equatable, Sendable, Identifiable {
  /// Domain whose reserved `lt-*` hosts are Pipper laptop tunnels.
  public static let laptopDomain = "pipper.dev"
  /// Port the laptop listens on when reached directly (Tailscale).
  public static let defaultLaptopPort = 4173

  public var code: String
  public var baseURL: URL

  public init?(code: String, baseURL: URL) {
    let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
    guard Self.isValidCode(trimmed), Self.isAllowedBase(baseURL) else { return nil }
    self.code = trimmed
    self.baseURL = baseURL
  }

  public var id: String { "\(baseURL.absoluteString)#\(code)" }

  public var host: String { baseURL.host?.lowercased() ?? "" }

  /// Reached through Pipper's own network (a named Cloudflare tunnel), so
  /// pipper.dev's signed owner statement can be checked for this host.
  public var isNamedTunnel: Bool { baseURL.scheme == "https" && Self.isLaptopTunnelHost(host) }

  /// Parses a scanned QR or pasted pairing link. Nil for anything else.
  public static func parse(_ text: String) -> PairingLink? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let components = URLComponents(string: trimmed), let fragment = components.fragment
    else { return nil }
    let params = fragmentParams(fragment)
    guard let code = params["pair"] else { return nil }
    if let host = params["host"] {
      // Hosted-app link: the laptop is named by `host`, never by the page.
      guard isLaptopTunnelHost(host), let base = URL(string: "https://\(host.lowercased())")
      else { return nil }
      return PairingLink(code: code, baseURL: base)
    }
    // Laptop-served link: the laptop is the page's own origin.
    guard let base = origin(of: components) else { return nil }
    return PairingLink(code: code, baseURL: base)
  }

  /// Typed or pasted by hand: a full pairing link in `address` wins;
  /// otherwise `address` names the laptop (`lt-….pipper.dev`, a Tailscale
  /// IP, or a URL) and `code` is the one shown under the QR.
  public static func manual(address: String, code: String) -> PairingLink? {
    let text = address.trimmingCharacters(in: .whitespacesAndNewlines)
    if let link = parse(text) { return link }
    guard !text.isEmpty else { return nil }
    let base: URL?
    if text.contains("://") {
      base = URLComponents(string: text).flatMap(origin(of:))
    } else {
      let host = text.split(separator: "/", maxSplits: 1).first.map(String.init) ?? text
      let bare = host.split(separator: ":", maxSplits: 1).first.map(String.init) ?? host
      if isLaptopTunnelHost(bare) {
        base = URL(string: "https://\(host.lowercased())")
      } else {
        base = URL(string: "http://\(host.contains(":") ? host : "\(host):\(defaultLaptopPort)")")
      }
    }
    return base.flatMap { PairingLink(code: code, baseURL: $0) }
  }

  // MARK: Rules

  static func isValidCode(_ code: String) -> Bool {
    code.range(of: #"^[0-9A-Za-z-]{4,32}$"#, options: .regularExpression) != nil
  }

  /// `lt-<label>.pipper.dev`: the only hosts the zone locks down as Pipper
  /// laptop APIs, so a link can't point this app (and its token) elsewhere.
  static func isLaptopTunnelHost(_ host: String, domain: String = laptopDomain) -> Bool {
    let h = host.lowercased()
    let suffix = ".\(domain.lowercased())"
    guard h.hasSuffix(suffix) else { return false }
    let label = String(h.dropLast(suffix.count))
    return label.range(of: #"^lt-[a-z0-9-]{1,48}$"#, options: .regularExpression) != nil
  }

  /// HTTPS to a Pipper tunnel (named or quick), or plain HTTP only where the
  /// laptop itself binds it: Tailscale (100.64/10) or loopback.
  static func isAllowedBase(_ url: URL) -> Bool {
    guard let host = url.host?.lowercased(), !host.isEmpty, url.user == nil else { return false }
    switch url.scheme {
    case "https":
      return isLaptopTunnelHost(host) || host.hasSuffix(".trycloudflare.com")
    case "http":
      return isTailscaleOrLoopback(host)
    default:
      return false
    }
  }

  static func isTailscaleOrLoopback(_ host: String) -> Bool {
    if host == "localhost" || host == "127.0.0.1" || host == "::1" { return true }
    let labels = host.split(separator: ".", omittingEmptySubsequences: false)
    let octets = labels.compactMap { UInt8($0) }
    guard labels.count == 4, octets.count == 4 else { return false }
    return octets[0] == 100 && (64...127).contains(octets[1])
  }

  private static func origin(of components: URLComponents) -> URL? {
    guard let scheme = components.scheme?.lowercased(), let host = components.host, !host.isEmpty
    else { return nil }
    var origin = URLComponents()
    origin.scheme = scheme
    origin.host = host.lowercased()
    origin.port = components.port
    return origin.url
  }

  private static func fragmentParams(_ fragment: String) -> [String: String] {
    var out: [String: String] = [:]
    for pair in fragment.split(separator: "&") {
      let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
      guard kv.count == 2, out[kv[0]] == nil else { continue }
      out[kv[0]] = kv[1].removingPercentEncoding ?? kv[1]
    }
    return out
  }
}

/// pipper.dev's signed "laptop H belongs to account S" statement
/// (`marketing/src/lib/laptop-attestation.ts`), checked with the public key
/// built into this app. A laptop can only present its real owner: someone
/// who sends a pairing link to *their* laptop shows *their* account.
public enum LaptopAttestation {
  /// Same key as the hosted phone app (`vite.remote-web.config.ts`). Rotate
  /// both together with pipper.dev's `PIPPER_LAPTOP_ATTESTATION_KEY`.
  public static let pipperPublicKey = "wwg9F0_hnCTB4nPa_zy3gFk5Blq2_NeVPruKcOWlAkQ"
  private static let prefix = "pa1"

  public enum Check: Equatable, Sendable {
    case verified(LaptopOwner)
    case unverified(String)
  }

  public static func verify(
    _ attestation: String?, host: String, publicKey: String = pipperPublicKey, now: Date = Date()
  ) -> Check {
    guard let attestation, !attestation.isEmpty else {
      return .unverified("The laptop didn't say who owns it.")
    }
    let parts = attestation.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
    guard parts.count == 3, parts[0] == prefix,
      let payload = base64URLDecode(parts[1]), let signature = base64URLDecode(parts[2])
    else { return .unverified("The laptop's owner statement is malformed.") }
    guard let keyData = base64URLDecode(publicKey),
      let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData)
    else { return .unverified("This app can't check laptop owners.") }
    guard key.isValidSignature(signature, for: Data("\(parts[0]).\(parts[1])".utf8)) else {
      return .unverified("The laptop's owner statement isn't signed by Pipper.")
    }
    struct Claims: Decodable {
      var host: String?
      var sub: String?
      var email: String?
      var name: String?
      var exp: Double?
    }
    guard let claims = try? JSONDecoder().decode(Claims.self, from: payload) else {
      return .unverified("The laptop's owner statement is malformed.")
    }
    guard claims.host == host.lowercased() else {
      return .unverified("The owner statement is for a different laptop.")
    }
    // `exp` is milliseconds since 1970, like Date.now() on pipper.dev.
    guard let exp = claims.exp, now.timeIntervalSince1970 * 1000 < exp else {
      return .unverified("The laptop's owner statement has expired.")
    }
    guard let sub = claims.sub, !sub.isEmpty else {
      return .unverified("The laptop's owner statement is malformed.")
    }
    return .verified(LaptopOwner(sub: sub, email: claims.email, name: claims.name))
  }

  static func base64URLDecode(_ value: String) -> Data? {
    var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    return Data(base64Encoded: base64)
  }
}
