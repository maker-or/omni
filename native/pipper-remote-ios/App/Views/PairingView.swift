import SwiftUI

/// Pair with the laptop: scan the QR from Pipper → Settings → Remote access
/// (or the terminal), or type the Tailscale host + token by hand.
struct PairingView: View {
  @Environment(RemoteSession.self) private var session
  @State private var host = ""
  @State private var port = String(RemoteConfig.defaultPort)
  @State private var token = ""
  @State private var scanning = false
  @State private var testing = false
  @State private var error: String?

  /// The host field tolerates `host:port` or a pasted URL; the port/token
  /// fields win only when the host field carried none.
  private var draft: RemoteConfig {
    let parsed = PairingURL.parseHostInput(host)
    return RemoteConfig(
      host: parsed?.host ?? "",
      port: parsed?.port ?? Int(port) ?? RemoteConfig.defaultPort,
      token: parsed?.token ?? token)
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Button {
            scanning = true
          } label: {
            Label("Scan pairing QR", systemImage: "qrcode.viewfinder")
          }
        } footer: {
          Text("On the Mac: Pipper → Settings → Remote access. The phone must be on the same Tailscale network.")
        }
        Section("Or enter manually") {
          TextField("Tailscale IP (100.x.x.x)", text: $host)
            .keyboardType(.numbersAndPunctuation)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onChange(of: host) { _, value in
              // Pasted "host:port" or a full pairing URL: split it into the
              // fields so what the user sees is what gets used.
              guard let parsed = PairingURL.parseHostInput(value),
                parsed.port != nil || parsed.token != nil
              else { return }
              host = parsed.host
              if let p = parsed.port { port = String(p) }
              if let t = parsed.token { token = t }
            }
          TextField("Port", text: $port)
            .keyboardType(.numberPad)
          SecureField("Pairing token", text: $token)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        }
        if let error {
          Section {
            Text(error).foregroundStyle(.red)
          }
        }
        Section {
          Button {
            Task { await pair(draft) }
          } label: {
            if testing {
              ProgressView()
            } else {
              Text("Pair")
            }
          }
          .disabled(!draft.isComplete || testing)
        }
      }
      .navigationTitle("Pair with your Mac")
      .sheet(isPresented: $scanning) {
        QRScannerSheet { text in
          scanning = false
          if let cfg = PairingURL.parse(text) {
            host = cfg.host
            port = String(cfg.port)
            token = cfg.token
            Task { await pair(cfg) }
          } else if PairingURL.isBareToken(text) {
            token = text.trimmingCharacters(in: .whitespacesAndNewlines)
          } else {
            error = "That QR isn't a Pipper pairing code."
          }
        }
      }
      .onOpenURL { url in
        // pipper-remote://pair?url=<encoded pairing url> — lets a future
        // desktop "Send to phone" open the app directly.
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
          let raw = items.first(where: { $0.name == "url" })?.value,
          let cfg = PairingURL.parse(raw)
        else { return }
        Task { await pair(cfg) }
      }
    }
  }

  private func pair(_ cfg: RemoteConfig) async {
    error = nil
    testing = true
    defer { testing = false }
    do {
      let ok = try await RemoteClient(config: cfg).health()
      guard ok else {
        error = "The Mac answered, but not as Pipper."
        return
      }
      session.pair(cfg)
      await session.refreshCatalog()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
