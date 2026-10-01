import Foundation
import Security

/// Minimal generic-password wrapper for the pairing token. Uses the app's
/// default keychain access group, which needs no extra entitlement.
enum Keychain {
  private static let service = "com.maker-or.omni.remote"

  static func read(_ account: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func write(_ account: String, value: String) throws {
    let add: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecValueData as String: Data(value.utf8),
      // Intents may run while the phone is locked (Siri from lock screen).
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
    ]
    var status = SecItemAdd(add as CFDictionary, nil)
    if status == errSecDuplicateItem {
      let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service, kSecAttrAccount as String: account]
      status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: Data(value.utf8)] as CFDictionary)
    }
    guard status == errSecSuccess else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status),
        userInfo: [NSLocalizedDescriptionKey: "Could not save pairing securely. \(Self.hint(for: status))"])
    }
  }

  /// A signed-but-unentitled app fails with `errSecMissingEntitlement`, which
  /// "unlock your phone" misleadingly hid; name the real cause when we know it.
  private static func hint(for status: OSStatus) -> String {
    switch status {
    case errSecInteractionNotAllowed:
      return "Unlock your phone and try again."
    case errSecMissingEntitlement:
      return "The app is missing its keychain entitlement — reinstall the signed build."
    default:
      return "Keychain error \(status)."
    }
  }

  static func delete(_ account: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
  }
}
