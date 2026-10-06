import SwiftUI
import Textual

/// One thread's transcript (polled every 3s — the laptop holds back
/// in-progress agent text, so replies arrive whole) plus a follow-up box.
struct ThreadDetailView: View {
  @Environment(RemoteSession.self) private var session
  @Environment(\.scenePhase) private var scenePhase
  let threadId: String

  #if DEBUG
  /// Preview-only seed; `previewReport` defaults to nil so the production
  /// call site (`ThreadDetailView(threadId:)`) is unchanged.
  init(threadId: String, previewReport: RemoteReport? = nil) {
    self.threadId = threadId
    if let previewReport {
      _report = State(initialValue: previewReport)
    }
  }
  #endif

  @State private var report: RemoteReport?
  @State private var loadError: String?
  @State private var controlling = false
  @State private var switchingModel = false
  @State private var loading = false
  @State private var draft = ""
  @State private var sending = false
  @State private var sendError: String?
  /// Optimistic bubble until the transcript includes the message.
  @State private var pending: (text: String, known: Int)?
  /// Sticky-bottom: auto-scroll only while the user is already at the end,
  /// or right after they send. Never yank someone who scrolled up to read.
  @State private var nearBottom = true
  @State private var forceScroll = false
  /// The Mac answered 404: the thread (or its worktree) was deleted there.
  /// Terminal — stop polling and don't offer a follow-up that can't land.
  @State private var missing = false

  var body: some View {
    if missing {
      ContentUnavailableView {
        Label("Thread no longer exists", systemImage: "trash")
      } description: {
        Text("It was deleted on your Mac, or its worktree was removed. Start a new thread from the list.")
      }
      .navigationTitle("Thread")
      .navigationBarTitleDisplayMode(.inline)
    } else {
      content
    }
  }

  private var content: some View {
    VStack(spacing: 0) {
      ScrollViewReader { proxy in
        ScrollView {
          // Plain VStack: Markdown rows settle their height after layout, and
          // a lazy stack's height estimates for off-screen rows make scrolling jump.
          VStack(alignment: .leading, spacing: 10) {
            if let report {
              if let loadError {
                Text("Connection lost. Showing the last update. \(loadError)")
                  .font(.footnote).foregroundStyle(.orange)
                Button("Retry connection") { Task { await load() } }
              }
              if let error = report.request?.error {
                Text(error).font(.footnote).foregroundStyle(.red)
              }
              ForEach(report.permissions ?? []) { decision in
                VStack(alignment: .leading, spacing: 8) {
                  Text(decision.title).font(.headline)
                  if let detail = decision.detail {
                    Text(detail).font(.caption.monospaced()).textSelection(.enabled)
                  }
                  ForEach(decision.options) { option in
                    Button(option.name) {
                      Task { await control(decision: decision.id, option: option.optionId) }
                    }.buttonStyle(.bordered).disabled(controlling || loadError != nil)
                  }
                  Button("Dismiss request", role: .destructive) {
                    Task { await control(decision: decision.id) }
                  }.disabled(controlling || loadError != nil)
                }
                .padding().background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
              }
              ForEach(Array(report.messages.enumerated()), id: \.offset) { _, m in
                Bubble(role: m.role, text: m.text)
              }
              if let pendingText = pendingVisible {
                Bubble(role: .user, text: pendingText, footnote: sending ? "Sending…" : "Sent · waiting for Mac…")
              }
              if report.running {
                HStack {
                  ProgressView().controlSize(.small)
                  Text("Working on your Mac…").font(.footnote).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 4)
              }
            } else {
              Text(loadError ?? "Loading…").foregroundStyle(.secondary).padding()
            }
            Color.clear.frame(height: 1).id("bottom")
          }
          .padding(12)
        }
        // Start at the bottom only. Pinning on every size change would yank
        // readers back down as Markdown re-lays out; sticky-bottom below
        // handles following new content.
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Bool.self) { geo in
          geo.contentOffset.y + geo.containerSize.height >= geo.contentSize.height - 120
        } action: { _, isNear in
          nearBottom = isNear
        }
        .onChange(of: scrollSignature) { _, _ in
          guard nearBottom || forceScroll else { return }
          forceScroll = false
          // Let the new rows lay out before asking for the bottom anchor.
          Task { @MainActor in
            await Task.yield()
            withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
          }
        }
      }
      composer
    }
    .navigationTitle(report?.summary ?? "Thread")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if let model = report?.model {
        ToolbarItem(placement: .topBarTrailing) { modelMenu(model) }
      }
    }
    .task(id: "\(threadId)-\(scenePhase == .active)") {
      if scenePhase == .active { await poll() }
    }
  }

  /// Applies to the next turn, so it's locked while the Mac is working.
  private func modelMenu(_ model: RemoteThreadModel) -> some View {
    Menu {
      Picker("Model", selection: Binding(
        get: { model.current ?? "" },
        set: { next in Task { await setModel(next) } }
      )) {
        ForEach(model.options) { m in
          Text(m.name).tag(m.id)
        }
      }
    } label: {
      HStack(spacing: 3) {
        Text(model.currentName ?? "Model")
        Image(systemName: "chevron.up.chevron.down").imageScale(.small)
      }
      .font(.footnote)
    }
    .disabled(report?.running == true || switchingModel || controlling)
    .accessibilityLabel("Model: \(model.currentName ?? "default")")
  }

  private func setModel(_ next: String) async {
    guard let client = session.client, !switchingModel, next != report?.model?.current else { return }
    switchingModel = true
    sendError = nil
    defer { switchingModel = false }
    do {
      let updated = try await client.setModel(threadId: threadId, model: next)
      report?.model = updated
    } catch {
      sendError = error.localizedDescription
    }
  }

  private var canSend: Bool {
    !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !sending && report?.running != true
  }

  /// Message-style composer: one rounded field with the action button inside.
  /// While the Mac is working the button stops the thread instead of sending.
  private var composer: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let sendError {
        Text(sendError).font(.footnote).foregroundStyle(.red).padding(.horizontal, 4)
      }
      HStack(alignment: .bottom, spacing: 6) {
        TextField(report?.running == true ? "Working on your Mac…" : "Follow up…", text: $draft, axis: .vertical)
          .lineLimit(1...6)
          .padding(.leading, 16)
          .padding(.vertical, 10)
        composerButton
          .padding(5)
      }
      .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 22, style: .continuous)
          .strokeBorder(Color(.separator).opacity(0.6), lineWidth: 0.5)
      )
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(.bar)
  }

  @ViewBuilder private var composerButton: some View {
    if report?.running == true {
      Button {
        Task { await control() }
      } label: {
        Image(systemName: "stop.fill")
          .font(.system(size: 12, weight: .bold))
          .foregroundStyle(Color(.systemBackground))
          .frame(width: 32, height: 32)
          .background(Color.primary, in: Circle())
      }
      .disabled(controlling)
      .accessibilityLabel("Stop this thread")
    } else {
      Button {
        Task { await send() }
      } label: {
        Image(systemName: "arrow.up")
          .font(.system(size: 15, weight: .bold))
          .foregroundStyle(.white)
          .frame(width: 32, height: 32)
          .background(canSend ? Color.accentColor : Color(.systemGray4), in: Circle())
      }
      .disabled(!canSend)
      .animation(.easeOut(duration: 0.15), value: canSend)
      .accessibilityLabel("Send follow-up")
    }
  }

  private var pendingVisible: String? {
    guard let pending, let report else { return nil }
    let count = report.messages.filter { $0.role == .user && $0.text == pending.text }.count
    return count > pending.known ? nil : pending.text
  }

  private var scrollSignature: String {
    [
      String(report?.messages.count ?? 0),
      String(report?.messages.last?.text.count ?? 0),
      pendingVisible ?? "",
      report?.running == true ? "run" : "idle",
    ].joined(separator: "|")
  }

  private func poll() async {
    while !Task.isCancelled && !missing {
      await load()
      try? await Task.sleep(for: .seconds(3))
    }
  }

  private func load() async {
    guard let client = session.client, !loading else { return }
    loading = true
    defer { loading = false }
    do {
      let next = try await client.report(threadId: threadId)
      guard !Task.isCancelled else { return }
      if next != report { report = next }
      if next.request?.state == "failed" || next.request?.state == "interrupted" { pending = nil }
      loadError = nil
      if let p = pending, next.messages.filter({ $0.role == .user && $0.text == p.text }).count > p.known {
        pending = nil
      }
    } catch RemoteClientError.http(status: 404, _) {
      missing = true
    } catch {
      loadError = error.localizedDescription
    }
  }

  private func control(decision: String? = nil, option: String? = nil) async {
    guard let client = session.client, !controlling else { return }
    controlling = true
    sendError = nil
    defer { controlling = false }
    do {
      if let decision {
        try await client.answer(threadId: threadId, decisionId: decision, optionId: option, cancelled: option == nil)
      } else {
        try await client.stop(threadId: threadId)
      }
    } catch {
      sendError = error.localizedDescription
    }
    await load()
  }

  private func send() async {
    guard session.isPaired, !sending else { return }
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    sending = true
    sendError = nil
    draft = ""
    let known = (report?.messages ?? []).filter { $0.role == .user && $0.text == text }.count
    forceScroll = true
    pending = (text, known)
    defer { sending = false }
    do {
      try await session.sendPrompt(threadId: threadId, prompt: text)
      await load()
    } catch {
      draft = text
      pending = nil
      sendError = error.localizedDescription
    }
  }
}

private struct Bubble: View {
  let role: RemoteMessage.Role
  let text: String
  var footnote: String? = nil

  var body: some View {
    if role == .user {
      HStack {
        Spacer(minLength: 40)
        VStack(alignment: .trailing, spacing: 3) {
          Text(text)
            .textSelection(.enabled)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 16))
            .foregroundStyle(.white)
          if let footnote {
            Text(footnote).font(.caption2).foregroundStyle(.secondary)
          }
        }
      }
    } else {
      // Agent replies are full Markdown (headings, lists, code, tables) and
      // get the whole width, with no bubble, so wide blocks have room.
      StructuredText(markdown: text)
        .textual.textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }
  }
}

#if DEBUG
#Preview("Thread — running") {
  NavigationStack {
    ThreadDetailView(threadId: PreviewData.report.threadId, previewReport: PreviewData.report)
  }
  .environment(RemoteSession.preview(catalog: PreviewData.catalog))
}

#Preview("Thread — needs input") {
  NavigationStack {
    ThreadDetailView(
      threadId: PreviewData.reportNeedsInput.threadId, previewReport: PreviewData.reportNeedsInput)
  }
  .environment(RemoteSession.preview(catalog: PreviewData.catalog))
}

#Preview("Thread — loading") {
  NavigationStack {
    ThreadDetailView(threadId: "00000000-0000-0000-0000-000000000000")
  }
  .environment(RemoteSession.preview(catalog: PreviewData.catalog))
}
#endif
