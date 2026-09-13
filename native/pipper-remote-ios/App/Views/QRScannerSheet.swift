import AVFoundation
import SwiftUI

/// Camera QR reader built on AVCaptureMetadataOutput — works on every device
/// and needs only NSCameraUsageDescription.
struct QRScannerSheet: View {
  let onCode: (String) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var denied = false

  var body: some View {
    NavigationStack {
      ZStack {
        if denied {
          ContentUnavailableView(
            "Camera access needed",
            systemImage: "camera.fill",
            description: Text("Allow camera access in Settings, or enter the token manually."))
        } else {
          QRScannerView(onCode: onCode, onDenied: { denied = true })
            .ignoresSafeArea()
          RoundedRectangle(cornerRadius: 16)
            .strokeBorder(.white.opacity(0.8), lineWidth: 2)
            .frame(width: 240, height: 240)
        }
      }
      .navigationTitle("Scan pairing code")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
      }
    }
  }
}

private struct QRScannerView: UIViewControllerRepresentable {
  let onCode: (String) -> Void
  let onDenied: () -> Void

  func makeUIViewController(context: Context) -> ScannerController {
    let vc = ScannerController()
    vc.onCode = onCode
    vc.onDenied = onDenied
    return vc
  }

  func updateUIViewController(_ uiViewController: ScannerController, context: Context) {}
}

final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
  var onCode: ((String) -> Void)?
  var onDenied: (() -> Void)?
  private let session = AVCaptureSession()
  private var preview: AVCaptureVideoPreviewLayer?
  private var fired = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
      DispatchQueue.main.async {
        guard let self else { return }
        if granted { self.configure() } else { self.onDenied?() }
      }
    }
  }

  private func configure() {
    guard let device = AVCaptureDevice.default(for: .video),
      let input = try? AVCaptureDeviceInput(device: device),
      session.canAddInput(input)
    else {
      onDenied?()
      return
    }
    session.addInput(input)
    let output = AVCaptureMetadataOutput()
    guard session.canAddOutput(output) else { return }
    session.addOutput(output)
    output.setMetadataObjectsDelegate(self, queue: .main)
    output.metadataObjectTypes = [.qr]
    let layer = AVCaptureVideoPreviewLayer(session: session)
    layer.videoGravity = .resizeAspectFill
    layer.frame = view.bounds
    view.layer.addSublayer(layer)
    preview = layer
    DispatchQueue.global(qos: .userInitiated).async { [session] in session.startRunning() }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    preview?.frame = view.bounds
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    if session.isRunning { session.stopRunning() }
  }

  func metadataOutput(
    _ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard !fired,
      let code = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first,
      let text = code.stringValue
    else { return }
    fired = true
    session.stopRunning()
    onCode?(text)
  }
}
