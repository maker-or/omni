import SwiftUI

/// One thread's transcript (polled every 3s — the laptop holds back
/// in-progress agent text, so replies arrive whole) plus a follow-up box.
struct ThreadDetailView: View {
  @Environment(RemoteSession.self) private var session
  @Environment(\.scenePhase) private var scenePhase
  let threadId: String

  @State private var report: RemoteReport?
  @State private var loadError: String?
  @State private var lastUpdated: Date?
  @State private var controlling = false
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
          LazyVStack(alignment: .leading, spacing: 10) {
            if let report {
              StatusCard(report: report)
              if let lastUpdated {
                Text("Updated \(lastUpdated.formatted(date: .omitted, time: .standard))")
                  .font(.caption).foregroundStyle(.secondary)
              }
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
              if report.running || !(report.permissions ?? []).isEmpty {
                Button("Stop this thread", role: .destructive) {
                  Task { await control() }
                }.buttonStyle(.bordered).disabled(controlling)
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
        .defaultScrollAnchor(.bottom)
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
      if let sendError {
        Text(sendError).font(.footnote).foregroundStyle(.red).padding(.horizontal)
      }
      Divider()
      HStack(alignment: .bottom) {
        TextField("Follow up…", text: $draft, axis: .vertical)
          .lineLimit(1...5)
          .textFieldStyle(.roundedBorder)
        Button {
          Task { await send() }
        } label: {
          Image(systemName: "paperplane.fill")
        }
        .buttonStyle(.borderedProminent)
        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending || report?.running == true)
        .accessibilityLabel("Send follow-up")
      }
      .padding(12)
    }
    .navigationTitle(report?.summary ?? "Thread")
    .navigationBarTitleDisplayMode(.inline)
    .task(id: "\(threadId)-\(scenePhase == .active)") {
      if scenePhase == .active { await poll() }
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
      lastUpdated = Date()
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

private struct StatusCard: View {
  let report: RemoteReport

  var body: some View {
    DisclosureGroup {
      VStack(alignment: .leading, spacing: 6) {
        if !report.isolated {
          Label(
            "Ran in project root — no isolated workspace." + (report.isolationNote.map { " \($0)" } ?? ""),
            systemImage: "exclamationmark.triangle")
          .font(.footnote)
          .foregroundStyle(.orange)
        }
        if let wt = report.worktreePath {
          Text(wt).font(.caption.monospaced()).foregroundStyle(.secondary)
        }
        if !report.filesTouched.isEmpty {
          ForEach(report.filesTouched, id: \.self) { f in
            Text(f).font(.caption.monospaced())
          }
        }
      }
      .padding(.top, 4)
    } label: {
      HStack(spacing: 8) {
        Circle().fill(report.running ? Color.green : Color.secondary.opacity(0.4)).frame(width: 8, height: 8)
        Text(!(report.permissions ?? []).isEmpty ? "Needs your input" : report.running ? "Running on Mac" : "Not running")
        if let p = report.projectName {
          Text("· \(p)").foregroundStyle(.secondary)
        }
        Spacer()
        if !report.filesTouched.isEmpty {
          Text("\(report.filesTouched.count) files").font(.caption).foregroundStyle(.secondary)
        }
      }
      .font(.subheadline)
    }
    .padding(10)
    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
  }
}

private struct Bubble: View {
  let role: RemoteMessage.Role
  let text: String
  var footnote: String? = nil

  var body: some View {
    HStack {
      if role == .user { Spacer(minLength: 40) }
      VStack(alignment: .trailing, spacing: 3) {
        Group {
          if role == .user {
            Text(text)
          } else {
            Text(markdown: text)
          }
        }
        .textSelection(.enabled)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
          role == .user ? Color.accentColor : Color(.secondarySystemBackground),
          in: RoundedRectangle(cornerRadius: 16))
        .foregroundStyle(role == .user ? Color.white : Color.primary)
        if let footnote {
          Text(footnote).font(.caption2).foregroundStyle(.secondary)
        }
      }
      if role == .agent { Spacer(minLength: 40) }
    }
  }
}

extension Text {
  /// Best-effort Markdown; falls back to plain text on parse failure.
  init(markdown: String) {
    if let attributed = try? AttributedString(
      markdown: markdown,
      options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
    {
      self.init(attributed)
    } else {
      self.init(markdown)
    }
  }
}
