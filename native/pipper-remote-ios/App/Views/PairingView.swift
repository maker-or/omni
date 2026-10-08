import SwiftUI

/// Pair with the laptop: scan the QR from Pipper → Settings → Remote → Pair a
/// phone, or paste its pairing link (or type the address and code). Either
/// way the laptop is shown for confirmation before the code is redeemed.
struct PairingView: View {
  @Environment(RemoteSession.self) private var session
  @State private var address = ""
  @State private var code = ""
  @State private var scanning = false
  @State private var error: String?
  /// A pairing link held until the user confirms it. Links, scans, and the
  /// custom URL scheme can come from anyone, so nothing pairs silently.
  @State private var pending: PairingLink?

  private var manual: PairingLink? { PairingLink.manual(address: address, code: code) }

  var body: some View {
    NavigationStack {
      Form {
        if let notice = session.pairNotice {
          Section {
            Label(notice, systemImage: "exclamationmark.triangle")
              .foregroundStyle(.orange)
          }
        }
        Section {
          Button {
            scanning = true
          } label: {
            Label("Scan pairing QR", systemImage: "qrcode.viewfinder")
          }
        } footer: {
          Text("On your Mac: Pipper → Settings → Remote → Pair a phone.")
        }
        Section {
          TextField("Pairing link or laptop address", text: $address)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onChange(of: address) { _, value in
              // A pasted pairing link carries its own code: show it.
              if let link = PairingLink.parse(value) { code = link.code }
            }
          TextField("Code (XXXXX-XXXXX)", text: $code)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .textContentType(.oneTimeCode)
        } header: {
          Text("Or enter manually")
        } footer: {
          Text("Paste the pairing link from your Mac, or type its address (lt-….pipper.dev) and the code shown under the QR.")
        }
        if let error {
          Section {
            Text(error).foregroundStyle(.red)
          }
        }
        Section {
          Button("Continue") {
            error = nil
            pending = manual
          }
          .disabled(manual == nil)
        }
      }
      .navigationTitle("Pair with your Mac")
      .sheet(isPresented: $scanning) {
        QRScannerSheet { text in
          scanning = false
          if let link = PairingLink.parse(text) {
            error = nil
            pending = link
          } else {
            error = "That QR isn't a Pipper pairing code. Make a new one on your Mac: Settings → Remote → Pair a phone."
          }
        }
      }
      .sheet(item: $pending) { link in
        ConfirmPairingView(link: link)
      }
      .onOpenURL { url in
        // pipper-remote://pair?url=<encoded pairing link> — still only offers
        // the laptop for confirmation.
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
          let raw = items.first(where: { $0.name == "url" })?.value,
          let link = PairingLink.parse(raw)
        else { return }
        pending = link
      }
    }
  }
}

/// Who the laptop is, before this phone redeems the code: a pairing link
/// could point at anyone's laptop, and pairing makes it the destination for
/// every task sent from this phone.
struct ConfirmPairingView: View {
  let link: PairingLink
  @Environment(RemoteSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var laptop: RemoteLaptopIdentity?
  /// Nil when the laptop isn't on a named tunnel, so no owner can be checked.
  @State private var owner: LaptopAttestation.Check?
  @State private var error: String?
  @State private var pairing = false

  var body: some View {
    NavigationStack {
      Form {
        Section {
          if let laptop {
            LabeledContent("Laptop", value: laptop.name)
            LabeledContent("Address", value: link.host)
            ownerRow
          } else if error == nil {
            HStack {
              ProgressView()
              Text("Checking the laptop…").foregroundStyle(.secondary)
            }
          }
        } footer: {
          Text("After pairing, the tasks you send from this phone and Siri go to this laptop.")
        }
        if let error {
          Section {
            Text(error).foregroundStyle(.red)
          }
        }
        Section {
          Button {
            Task { await pair() }
          } label: {
            if pairing {
              ProgressView()
            } else {
              Text("Pair with \(laptop?.name ?? "this laptop")")
            }
          }
          .disabled(laptop == nil || pairing)
        }
      }
      .navigationTitle("Pair with this laptop?")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
            .disabled(pairing)
        }
      }
      .task { await load() }
    }
    .interactiveDismissDisabled(pairing)
  }

  @ViewBuilder private var ownerRow: some View {
    switch owner {
    case .verified(let who):
      Label("Belongs to \(who.label) — verified by Pipper", systemImage: "checkmark.seal.fill")
        .foregroundStyle(.green)
    case .unverified(let reason):
      Label(
        "Unverified: \(reason) Pair only if you just made this code on your own Mac.",
        systemImage: "exclamationmark.triangle.fill"
      )
      .foregroundStyle(.orange)
    case nil:
      Label(
        "This laptop isn't on Pipper's network, so its owner can't be checked. Pair only if you just made this code on your own Mac.",
        systemImage: "exclamationmark.triangle"
      )
      .foregroundStyle(.secondary)
    }
  }

  private func load() async {
    #if DEBUG
    if session.client == nil, link.host.hasPrefix("lt-preview") {
      laptop = RemoteLaptopIdentity(name: "Studio", host: link.host, attestation: nil)
      owner = .verified(LaptopOwner(sub: "preview", email: "me@example.com", name: nil))
      return
    }
    #endif
    do {
      let identity = try await RemoteClient.previewPairing(link)
      if link.isNamedTunnel {
        owner = LaptopAttestation.verify(identity.attestation, host: link.host)
      }
      laptop = identity
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func pair() async {
    guard !pairing else { return }
    pairing = true
    error = nil
    defer { pairing = false }
    let verified: LaptopOwner? = if case .verified(let who) = owner { who } else { nil }
    do {
      try await session.pair(link, owner: verified)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

#if DEBUG
#Preview("Pairing") {
  PairingView()
    .environment(RemoteSession.preview())
}

#Preview("Confirm") {
  ConfirmPairingView(link: PairingLink(code: "ABCDE12345", baseURL: URL(string: "https://lt-preview.pipper.dev")!)!)
    .environment(RemoteSession.preview())
}
#endif
