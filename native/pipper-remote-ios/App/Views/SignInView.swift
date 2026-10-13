import SwiftUI

/// First screen for everyone: sign in to Pipper with GitHub. The GitHub
/// connection is what pipper.dev uses for the GitHub Siri actions.
struct SignInView: View {
  @Environment(PipperAccount.self) private var account

  var body: some View {
    VStack(spacing: 24) {
      Spacer()
      Image(systemName: "bubble.left.and.text.bubble.right.fill")
        .font(.system(size: 56))
        .foregroundStyle(.indigo)
      VStack(spacing: 8) {
        Text("Welcome to Pipper")
          .font(.largeTitle.bold())
        Text("Sign in with GitHub to file issues and check your pull requests with Siri.")
          .font(.body)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
      Spacer()
      if let error = account.signInError {
        Text(error)
          .font(.footnote)
          .foregroundStyle(.red)
          .multilineTextAlignment(.center)
      }
      Button {
        Task { await account.signInWithGitHub() }
      } label: {
        HStack {
          if account.signingIn { ProgressView().tint(.white) }
          Text("Continue with GitHub")
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
      }
      .buttonStyle(.borderedProminent)
      .tint(.indigo)
      .disabled(account.signingIn)
    }
    .padding(24)
  }
}

#if DEBUG
#Preview {
  SignInView()
    .environment(PipperAccount.shared)
}
#endif
