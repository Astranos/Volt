@preconcurrency import AVFoundation
import AVFAudio
import AudioToolbox
import CoreImage
import CoreImage.CIFilterBuiltins
import ImageIO
import SwiftUI
import UIKit
@preconcurrency import Vision
import VisionKit

private let signalBaseURL = URL(string: "https://scanner-signal.vercel.app/api/signal")!
private let validModes: Set<String> = ["ocr", "barcode", "photo", "dictation"]
private let clipZoomStops: [CGFloat] = [1, 1.5, 2, 2.5, 3, 3.5, 4]

@UIApplicationMain
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  private let model = ClipModel()

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = UIHostingController(rootView: ClipRootView(model: model))
    window.tintColor = .white
    window.makeKeyAndVisible()
    self.window = window

    if
      let activityDictionary = launchOptions?[.userActivityDictionary] as? [AnyHashable: Any],
      let activity = activityDictionary.values.compactMap({ $0 as? NSUserActivity }).first
    {
      model.handle(activity: activity)
    }

    return true
  }

  func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    model.handle(activity: userActivity)
    return true
  }

  func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    model.handle(url: url)
    return true
  }
}

private enum ClipMode: String, CaseIterable, Identifiable {
  case ocr
  case barcode
  case photo
  case dictation

  var id: String { rawValue }

  var title: String {
    switch self {
    case .ocr: return "Text"
    case .barcode: return "Scan"
    case .photo: return "Photo"
    case .dictation: return "Speak"
    }
  }

  var symbol: String {
    switch self {
    case .ocr: return "doc.text.viewfinder"
    case .barcode: return "barcode.viewfinder"
    case .photo: return "camera.viewfinder"
    case .dictation: return "mic"
    }
  }
}

private struct ClipInvocation {
  let mode: ClipMode
  let sessionId: String
}

@MainActor
private final class ClipModel: ObservableObject {
  @Published var mode: ClipMode = .barcode
  @Published var sessionId: String?
  @Published var status = "Scan the Chrome QR to pair"
  @Published var error: String?
  @Published var isPairing = true
  @Published var isSending = false
  @Published var lastText = ""
  @Published var barcodeCandidate: BarcodeCandidate?
  @Published var torchEnabled = false
  @Published var zoomFactor: CGFloat = 1
  @Published var autoSendBarcode = true
  @Published var fullFrameScan = false
  @Published var insertIntoCursor = true
  @Published var dictationAddsPunctuation = true
  @Published var dictationRunning = false
  @Published var dictationPressActive = false
  @Published var dictationTranscript = ""
  @Published var textCapture: TextCapture?
  @Published var textCaptureShowsCleanedImage = false
  @Published var isExtractingText = false

  let camera = ClipCamera()
  let dictation = ClipDictation()
  private let zoomHaptic = UISelectionFeedbackGenerator()
  private let impactHaptic = UIImpactFeedbackGenerator(style: .light)
  private let notificationHaptic = UINotificationFeedbackGenerator()
  private var pasteboardChangeCount = UIPasteboard.general.changeCount
  private var barcodeCandidateClearTask: Task<Void, Never>?

  init() {
    zoomHaptic.prepare()
    impactHaptic.prepare()
    notificationHaptic.prepare()

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handlePasteboardChange),
      name: UIPasteboard.changedNotification,
      object: UIPasteboard.general
    )

    camera.onBarcode = { [weak self] candidate in
      Task { @MainActor in
        guard let self else { return }
        self.barcodeCandidateClearTask?.cancel()
        self.barcodeCandidate = candidate
        if self.isPairing {
          self.handlePairingCandidate(candidate)
          return
        }
        self.status = "Code found"
        if self.autoSendBarcode {
          await self.sendBarcode(candidate)
        }
      }
    }
    camera.onBarcodeLost = { [weak self] in
      Task { @MainActor in
        self?.scheduleBarcodeCandidateClear(after: 0.35)
      }
    }

    dictation.onPartial = { [weak self] text in
      Task { @MainActor in
        guard let self else { return }
        self.dictationTranscript = text
        await self.sendDictation(text: text, phase: "partial", background: true)
      }
    }

    dictation.onFinal = { [weak self] text in
      Task { @MainActor in
        guard let self else { return }
        self.dictationTranscript = text
        self.status = "Release to send"
      }
    }
  }

  deinit {
    barcodeCandidateClearTask?.cancel()
    NotificationCenter.default.removeObserver(self)
  }

  func handle(activity: NSUserActivity) {
    guard let url = activity.webpageURL else { return }
    handle(url: url)
  }

  func handle(url: URL) {
    guard let invocation = parseInvocation(url: url) else {
      beginPairing()
      return
    }

    mode = invocation.mode
    sessionId = invocation.sessionId
    isPairing = false
    error = nil
    status = "Paired with Chrome"
    Task { await connect() }
  }

  func beginPairing() {
    stopMode()
    isPairing = true
    mode = .barcode
    sessionId = nil
    barcodeCandidate = nil
    zoomFactor = 1
    torchEnabled = false
    fullFrameScan = false
    error = nil
    status = "Scan the Chrome QR to pair"
    clearTextCapture()
    startMode()
  }

  func unpair() {
    beginPairing()
  }

  func selectMode(_ nextMode: ClipMode) {
    guard mode != nextMode else { return }
    selectionFeedback()
    stopMode()
    mode = nextMode
    barcodeCandidate = nil
    error = nil
    if nextMode != .ocr {
      clearTextCapture()
    }
    startMode()
  }

  private func handlePairingCandidate(_ candidate: BarcodeCandidate) {
    guard let url = URL(string: candidate.value), parseInvocation(url: url) != nil else {
      status = candidate.format == "qr" ? "That QR is not a Volt Chrome pairing code" : "Point at the Chrome QR"
      return
    }
    barcodeCandidateClearTask?.cancel()
    barcodeCandidate = nil
    status = "Pairing with Chrome"
    handle(url: url)
  }

  func connect() async {
    guard let sessionId else { return }
    do {
      _ = try await postJSON(path: "\(sessionId)/connect", body: [:])
    } catch {
      if let httpError = error as? ClipHTTPStatusError, httpError.statusCode == 404 {
        do {
          try await repairRelaySession(mode: mode)
          _ = try await postJSON(path: "\(sessionId)/connect", body: [:])
          return
        } catch {}
      }
      self.error = "Chrome session is unavailable. Reopen the QR code."
    }
  }

  func startMode() {
    error = nil
    switch mode {
    case .ocr, .photo, .barcode:
      guard !isExtractingText, textCapture == nil else {
        camera.stop()
        return
      }
      camera.start()
      camera.setMode(isPairing ? .barcode : mode)
      camera.setBarcodeFullFrame(fullFrameScan || isPairing)
      camera.setTorch(torchEnabled)
      camera.setZoom(zoomFactor)
    case .dictation:
      camera.stop()
    }
  }

  func stopMode() {
    camera.stop()
    if mode == .dictation {
      dictation.stop()
      dictationRunning = false
      dictationPressActive = false
    }
  }

  func capturePrimary() {
    impactFeedback()
    playCaptureSound()
    switch mode {
    case .ocr:
      if textCapture != nil {
        clearTextCapture()
        status = "Ready"
        return
      }
      status = "Capturing text"
      camera.capturePhoto { [weak self] result in
        Task { @MainActor in
          guard let self else { return }
          switch result {
          case .success(let photo):
            self.isExtractingText = true
            self.camera.stop()
            await self.prepareTextCapture(photo: photo)
          case .failure(let error):
            self.error = error.localizedDescription
          }
        }
      }
    case .photo:
      status = "Sending photo"
      camera.capturePhoto { [weak self] result in
        Task { @MainActor in
          guard let self else { return }
          switch result {
          case .success(let photo):
            await self.sendPhoto(photo)
          case .failure(let error):
            self.error = error.localizedDescription
          }
        }
      }
    case .barcode:
      if let barcodeCandidate {
        Task { await sendBarcode(barcodeCandidate) }
      }
    case .dictation:
      break
    }
  }

  func beginDictationPress() {
    guard mode == .dictation, !dictationPressActive else { return }
    dictationPressActive = true
    impactFeedback()
    AudioServicesPlaySystemSound(1113)
    Task { await startDictation() }
  }

  func endDictationPress() {
    guard mode == .dictation, dictationPressActive else { return }
    dictationPressActive = false
    AudioServicesPlaySystemSound(1114)
    notificationHaptic.notificationOccurred(.success)
    notificationHaptic.prepare()

    Task { @MainActor in
      status = "Finishing dictation"
      let completedText = await dictation.finishAndStop(timeout: 2.0)
      dictationRunning = false
      let finalText = (completedText ?? dictationTranscript).trimmingCharacters(in: .whitespacesAndNewlines)
      guard !finalText.isEmpty else {
        status = "No dictation captured"
        notificationHaptic.notificationOccurred(.warning)
        notificationHaptic.prepare()
        return
      }
      dictationTranscript = finalText
      await sendDictation(text: finalText, phase: "final", background: false)
    }
  }

  func startDictation() async {
    guard let sessionId else {
      dictationPressActive = false
      error = "Pair with Chrome before dictating."
      return
    }
    do {
      dictationTranscript = ""
      status = "Listening"
      try await dictation.start(sessionId: sessionId)
      guard dictationPressActive else {
        dictation.stop()
        return
      }
      dictationRunning = true
      status = "Listening"
    } catch {
      dictationRunning = false
      dictationPressActive = false
      self.error = error.localizedDescription
    }
  }

  func setTorch(_ enabled: Bool) {
    selectionFeedback()
    torchEnabled = enabled
    camera.setTorch(enabled)
  }

  func setZoom(_ factor: CGFloat) {
    zoomFactor = factor
    camera.setZoom(factor)
  }

  func setZoomStop(_ factor: CGFloat, haptic: Bool = true) {
    let snapped = nearestZoomStop(to: factor)
    if haptic && abs(snapped - zoomFactor) > 0.01 {
      zoomHaptic.selectionChanged()
      zoomHaptic.prepare()
    }
    setZoom(snapped)
  }

  func setFullFrameScan(_ enabled: Bool) {
    selectionFeedback()
    fullFrameScan = enabled
    camera.setBarcodeFullFrame(enabled || isPairing)
  }

  func clearTextCapture() {
    textCapture = nil
    textCaptureShowsCleanedImage = false
    lastText = ""
    isExtractingText = false
    if mode == .ocr {
      startMode()
    }
  }

  private func scheduleBarcodeCandidateClear(after delay: TimeInterval) {
    barcodeCandidateClearTask?.cancel()
    barcodeCandidateClearTask = Task { @MainActor in
      let nanoseconds = UInt64(max(0, delay) * 1_000_000_000)
      try? await Task.sleep(nanoseconds: nanoseconds)
      guard !Task.isCancelled else { return }
      barcodeCandidate = nil
    }
  }

  private func prepareTextCapture(photo: CapturedPhoto) async {
    defer {
      isExtractingText = false
      if mode == .ocr, textCapture == nil {
        startMode()
      }
    }
    do {
      let cleaned = try await TextImageEnhancer.cleanedImage(from: photo.image)
      let text = try await TextRecognizer.recognize(cgImage: cleaned.cgImage)
      lastText = text
      textCapture = TextCapture(originalImage: photo.uiImage, cleanedImage: cleaned.uiImage)
      textCaptureShowsCleanedImage = false
      pasteboardChangeCount = UIPasteboard.general.changeCount
      guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        status = "No text found"
        return
      }
      status = "Select text and copy"
      notificationHaptic.notificationOccurred(.success)
      notificationHaptic.prepare()
      Task { @MainActor in
        try? await Task.sleep(nanoseconds: 360_000_000)
        guard self.textCapture != nil else { return }
        withAnimation(.easeInOut(duration: 0.36)) {
          self.textCaptureShowsCleanedImage = true
        }
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  @objc private func handlePasteboardChange() {
    guard textCapture != nil else { return }
    guard UIPasteboard.general.changeCount != pasteboardChangeCount else { return }
    pasteboardChangeCount = UIPasteboard.general.changeCount
    let copiedText = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !copiedText.isEmpty else { return }
    Task { @MainActor in
      await sendCopiedText(copiedText)
    }
  }

  private func sendCopiedText(_ text: String) async {
    do {
      try await sendResult(mode: .ocr, message: [
        "barcode": text,
        "format": "live-text",
        "insertIntoCursor": insertIntoCursor,
        "kind": "text",
        "scannedAt": ISO8601DateFormatter().string(from: Date()),
      ])
      status = "Copied text sent to Chrome"
      notificationHaptic.notificationOccurred(.success)
      notificationHaptic.prepare()
    } catch {
      self.error = error.localizedDescription
      notificationHaptic.notificationOccurred(.warning)
      notificationHaptic.prepare()
    }
  }

  private func playCaptureSound() {
    AudioServicesPlaySystemSound(1108)
  }

  private func impactFeedback() {
    impactHaptic.impactOccurred(intensity: 0.55)
    impactHaptic.prepare()
  }

  private func selectionFeedback() {
    zoomHaptic.selectionChanged()
    zoomHaptic.prepare()
  }

  private func sendBarcode(_ candidate: BarcodeCandidate) async {
    guard !isSending else { return }
    do {
      try await sendResult(mode: .barcode, message: [
        "barcode": candidate.value,
        "format": candidate.format,
        "insertIntoCursor": true,
        "kind": "barcode",
        "scannedAt": ISO8601DateFormatter().string(from: Date()),
      ])
      status = "Sent to Chrome"
      scheduleBarcodeCandidateClear(after: 0.45)
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func sendDictation(text: String, phase: String, background: Bool) async {
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    do {
      try await sendResult(mode: .dictation, message: [
        "barcode": text,
        "dictationPhase": phase,
        "dictationSessionId": dictation.sessionId,
        "format": "dictation",
        "insertIntoCursor": true,
        "kind": "text",
        "scannedAt": ISO8601DateFormatter().string(from: Date()),
      ], background: background)
      if !background {
        status = "Sent to Chrome"
      }
    } catch {
      if !background {
        self.error = error.localizedDescription
      }
    }
  }

  private func sendPhoto(_ photo: CapturedPhoto) async {
    do {
      let base64 = photo.data.base64EncodedString()
      try await sendResult(mode: .photo, message: [
        "kind": "photo",
        "id": "clip-photo-\(Int(Date().timeIntervalSince1970 * 1000))",
        "name": "volt-photo.jpg",
        "mimeType": "image/jpeg",
        "dataUrl": "data:image/jpeg;base64,\(base64)",
        "size": photo.data.count,
        "width": Int(photo.size.width),
        "height": Int(photo.size.height),
        "capturedAt": ISO8601DateFormatter().string(from: Date()),
      ])
      status = "Sent to Chrome"
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func sendResult(mode: ClipMode, message: [String: Any], background: Bool = false) async throws {
    guard let sessionId else {
      throw ClipError.message("Scan the Chrome QR to pair first.")
    }

    if !background {
      isSending = true
    }
    defer {
      if !background {
        isSending = false
      }
    }

    let body: [String: Any] = [
      "id": "\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8))",
      "mode": mode.rawValue,
      "message": message,
    ]

    do {
      _ = try await postJSON(path: "\(sessionId)/result", body: body)
    } catch {
      guard let httpError = error as? ClipHTTPStatusError, httpError.statusCode == 404 else {
        throw error
      }
      try await repairRelaySession(mode: mode)
      _ = try await postJSON(path: "\(sessionId)/result", body: body)
    }
  }

  private func repairRelaySession(mode: ClipMode) async throws {
    guard let sessionId else { return }
    _ = try await postJSON(path: sessionId, body: [
      "relay": true,
      "mode": mode.rawValue,
    ])
  }

  private func postJSON(path: String, body: [String: Any]) async throws -> [String: Any] {
    let url = signalBaseURL.appendingPathComponent(path)
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw ClipError.message("Chrome session did not respond.")
    }
    guard (200..<300).contains(http.statusCode) else {
      if http.statusCode == 404 {
        throw ClipHTTPStatusError(statusCode: http.statusCode)
      }
      throw ClipError.message("Chrome session returned \(http.statusCode).")
    }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
  }

  private func parseInvocation(url: URL) -> ClipInvocation? {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    let parts = components.path.split(separator: "/").map(String.init)
    let clipIndex = parts.firstIndex(of: "clip")
    let pathMode = clipIndex.flatMap { parts.indices.contains($0 + 1) ? parts[$0 + 1] : nil } ?? parts.first
    let query = components.queryItems ?? []
    let queryMode = query.first(where: { $0.name == "mode" })?.value
    let modeValue = queryMode ?? (validModes.contains(pathMode ?? "") ? pathMode : nil)
    let session = query.first(where: { $0.name == "session" })?.value
    guard
      let modeValue,
      validModes.contains(modeValue),
      let mode = ClipMode(rawValue: modeValue),
      let session,
      session.range(of: #"^[A-Za-z0-9_-]{4,80}$"#, options: .regularExpression) != nil
    else {
      return nil
    }
    return ClipInvocation(mode: mode, sessionId: session)
  }
}

private struct ClipRootView: View {
  @ObservedObject var model: ClipModel
  @State private var drawerProgress: CGFloat = 0
  @State private var drawerDragStartProgress: CGFloat?

  var body: some View {
    ZStack {
      ViewfinderBackground(model: model)

      VStack(spacing: 0) {
        header
        Spacer()
        shutterButton
          .padding(.trailing, 34)
          .padding(.bottom, 14)
        controls
      }
      .padding(.horizontal, 18)
      .padding(.top, 16)
      .padding(.bottom, 0)
    }
    .ignoresSafeArea(.container, edges: .bottom)
    .background(Color.black)
    .foregroundStyle(.white)
    .onAppear { model.startMode() }
    .onChange(of: model.mode) { _ in model.startMode() }
  }

  private var header: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 8) {
        Text(model.mode.title)
          .font(.system(size: 30, weight: .bold, design: .rounded))
        Text(model.error ?? model.status)
          .font(.system(size: 15, weight: .medium))
          .foregroundStyle(model.error == nil ? .white.opacity(0.78) : .red.opacity(0.95))
          .lineLimit(2)
      }
      Spacer(minLength: 8)
      if !model.isPairing {
        Button(action: model.unpair) {
          Image(systemName: "link.badge.minus")
            .font(.system(size: 16, weight: .bold))
            .frame(width: 42, height: 42)
            .foregroundStyle(.white)
            .background(.white.opacity(0.14), in: Circle())
        }
        .accessibilityLabel("Unpair from Chrome")
        .buttonStyle(.plain)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.top, 8)
  }

  private var controls: some View {
    let clampedDrawerProgress = max(0, min(1, drawerProgress))
    let edgeInset = drawerEdgeInset(progress: clampedDrawerProgress)
    let drawerRadius = drawerCornerRadius(progress: clampedDrawerProgress)
    let topPadding = 12 + (16 * clampedDrawerProgress)
    let bottomPadding = 16 + (8 * clampedDrawerProgress)
    let expandedHeight = expandedControlsHeight * clampedDrawerProgress

    return VStack(spacing: 14) {
      drawerHandle(clampedDrawerProgress: clampedDrawerProgress)

      secondaryControls

      expandedDrawerControls
        .frame(height: expandedHeight, alignment: .top)
        .opacity(clampedDrawerProgress)
        .clipped()
    }
    .padding(.horizontal, 16)
    .padding(.top, topPadding)
    .padding(.bottom, bottomPadding)
    .frame(maxWidth: .infinity)
    .background {
      ConcentricLiquidDrawer(cornerRadius: drawerRadius)
    }
    .contentShape(Rectangle())
    .simultaneousGesture(drawerDragGesture)
    .padding(.horizontal, -(18 - edgeInset))
    .padding(.bottom, edgeInset)
  }

  private var expandedControlsHeight: CGFloat {
    138
  }

  private func drawerEdgeInset(progress: CGFloat) -> CGFloat {
    12 - (2 * progress)
  }

  private func drawerCornerRadius(progress: CGFloat) -> CGFloat {
    56 - (6 * progress)
  }

  private func drawerHandle(clampedDrawerProgress: CGFloat) -> some View {
    Capsule()
      .fill(.white.opacity(0.34))
      .frame(width: 46, height: 5)
      .frame(maxWidth: .infinity, minHeight: 28)
      .contentShape(Rectangle())
      .padding(.bottom, model.mode == .dictation ? 0 : 2)
      .onTapGesture {
        toggleDrawer()
      }
      .gesture(
        drawerDragGesture
      )
      .accessibilityLabel(clampedDrawerProgress > 0.5 ? "Collapse controls" : "Expand controls")
      .accessibilityAddTraits(.isButton)
  }

  private var drawerDragGesture: some Gesture {
    DragGesture(minimumDistance: 4, coordinateSpace: .global)
      .onChanged { value in
        guard abs(value.translation.height) > abs(value.translation.width) * 0.7 else { return }
        let startProgress = drawerDragStartProgress ?? drawerProgress
        if drawerDragStartProgress == nil {
          drawerDragStartProgress = startProgress
        }
        let next = startProgress - value.translation.height / 220
        drawerProgress = max(0, min(1, next))
      }
      .onEnded { value in
        let startProgress = drawerDragStartProgress ?? drawerProgress
        drawerDragStartProgress = nil
        let projected = startProgress - value.predictedEndTranslation.height / 220
        let current = startProgress - value.translation.height / 220
        let velocityBias: CGFloat = value.predictedEndTranslation.height < value.translation.height ? 0.08 : -0.08
        let target: CGFloat = projected + velocityBias > 0.42 || current > 0.52 ? 1 : 0
        withAnimation(.interactiveSpring(response: 0.24, dampingFraction: 0.82)) {
          drawerProgress = target
        }
      }
  }

  private func toggleDrawer() {
    let target: CGFloat = drawerProgress > 0.5 ? 0 : 1
    withAnimation(.interactiveSpring(response: 0.28, dampingFraction: 0.86)) {
      drawerProgress = target
    }
  }

  private var secondaryControls: some View {
    HStack(spacing: 14) {
      ToggleButton(title: "Type to browser cursor", symbol: "text.cursor", isOn: model.insertIntoCursor) {
        model.insertIntoCursor.toggle()
      }

      if model.mode == .barcode {
        ToggleButton(title: "Auto", symbol: "bolt.fill", isOn: model.autoSendBarcode) {
          model.autoSendBarcode.toggle()
        }
      } else if model.mode != .dictation {
        ToggleButton(title: "Light", symbol: "flashlight.on.fill", isOn: model.torchEnabled) {
          model.setTorch(!model.torchEnabled)
        }
      } else {
        ToggleButton(title: "Punctuation", symbol: "textformat", isOn: model.dictationAddsPunctuation) {
          model.dictationAddsPunctuation.toggle()
        }
      }
    }
  }

  private var expandedDrawerControls: some View {
    VStack(spacing: 10) {
      if model.mode != .dictation {
        ZoomSlider(factor: model.zoomFactor) { factor in
          model.setZoom(factor)
        }
      } else {
        dictationPreview
      }
      modePicker
        .padding(.top, 2)
    }
    .padding(.top, 2)
  }

  private var dictationPreview: some View {
    Text(dictationDrawerText)
      .font(.system(size: 16, weight: .semibold))
      .frame(maxWidth: .infinity, minHeight: 56, alignment: .center)
      .multilineTextAlignment(.center)
      .lineLimit(2)
  }

  private var dictationDrawerText: String {
    if !model.dictationTranscript.isEmpty {
      return model.dictationTranscript
    }
    return model.dictationPressActive ? "Keep holding and speak into the phone" : "Hold the microphone button to start"
  }

  private var shutterButton: some View {
    HStack {
      Spacer()
      VStack(spacing: 8) {
        Button(action: model.mode == .dictation ? {} : model.capturePrimary) {
          ZStack {
            Circle()
              .fill(.white.opacity(model.dictationPressActive ? 0.90 : 0.82))
              .frame(width: 76, height: 76)
              .liquidGlassSurface(shape: Circle(), intensity: .strong, isActive: true)
              .overlay {
                if model.mode == .dictation {
                  Circle()
                    .stroke(.black.opacity(model.dictationPressActive ? 0.32 : 0.16), lineWidth: model.dictationPressActive ? 5 : 2)
                    .padding(model.dictationPressActive ? 5 : 8)
                }
              }
            Image(systemName: primarySymbol)
              .font(.system(size: 29, weight: .bold))
              .foregroundStyle(.black)
          }
          .scaleEffect(model.dictationPressActive ? 0.94 : 1)
          .animation(.easeOut(duration: 0.10), value: model.dictationPressActive)
        }
        .simultaneousGesture(
          DragGesture(minimumDistance: 0)
            .onChanged { _ in
              if model.mode == .dictation {
                model.beginDictationPress()
              }
            }
            .onEnded { _ in
              if model.mode == .dictation {
                model.endDictationPress()
              }
            }
        )
        .disabled(model.isSending && model.mode != .dictation)
        .buttonStyle(.plain)
        .accessibilityLabel(model.mode == .dictation ? "Hold to dictate" : model.mode == .ocr && model.textCapture != nil ? "Retake text capture" : "Capture")
      }
    }
  }

  private var modePicker: some View {
    NativeLiquidModePicker(selectedMode: model.mode) { mode in
      model.selectMode(mode)
    }
    .frame(height: 46)
    .padding(.horizontal, 4)
    .liquidGlassSurface(shape: Capsule(), intensity: .medium)
    .accessibilityLabel("Mode")
  }

  private var primarySymbol: String {
    switch model.mode {
    case .ocr: return model.textCapture == nil ? "text.viewfinder" : "arrow.counterclockwise"
    case .barcode: return "paperplane.fill"
    case .photo: return "camera.fill"
    case .dictation: return model.dictationRunning ? "stop.fill" : "mic.fill"
    }
  }
}

private struct ConcentricLiquidDrawer: View {
  let cornerRadius: CGFloat

  var body: some View {
    let bottomRadius = max(44, cornerRadius - 4)
    let shape = UnevenRoundedRectangle(
      topLeadingRadius: cornerRadius,
      bottomLeadingRadius: bottomRadius,
      bottomTrailingRadius: bottomRadius,
      topTrailingRadius: cornerRadius,
      style: .continuous
    )

    shape
      .fill(Color.white.opacity(0.11))
      .background {
        shape.fill(.ultraThinMaterial.opacity(0.18))
      }
      .liquidGlassSurface(shape: shape, intensity: .soft)
  }
}

private struct NativeLiquidModePicker: UIViewRepresentable {
  let selectedMode: ClipMode
  let onSelect: (ClipMode) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(onSelect: onSelect)
  }

  func makeUIView(context: Context) -> UISegmentedControl {
    let control = UISegmentedControl()
    control.selectedSegmentTintColor = UIColor.white.withAlphaComponent(0.88)
    control.backgroundColor = UIColor.white.withAlphaComponent(0.08)
    control.setTitleTextAttributes([
      .font: UIFont.systemFont(ofSize: 12, weight: .semibold),
      .foregroundColor: UIColor.white.withAlphaComponent(0.82),
    ], for: .normal)
    control.setTitleTextAttributes([
      .font: UIFont.systemFont(ofSize: 12, weight: .bold),
      .foregroundColor: UIColor.black,
    ], for: .selected)
    control.addTarget(context.coordinator, action: #selector(Coordinator.valueChanged(_:)), for: .valueChanged)
    configureSegments(control)
    return control
  }

  func updateUIView(_ uiView: UISegmentedControl, context: Context) {
    context.coordinator.onSelect = onSelect
    if uiView.numberOfSegments != ClipMode.allCases.count {
      configureSegments(uiView)
    }
    uiView.selectedSegmentIndex = ClipMode.allCases.firstIndex(of: selectedMode) ?? UISegmentedControl.noSegment
  }

  private func configureSegments(_ control: UISegmentedControl) {
    control.removeAllSegments()
    for (index, mode) in ClipMode.allCases.enumerated() {
      control.insertSegment(withTitle: mode.title, at: index, animated: false)
      control.setWidth(0, forSegmentAt: index)
    }
    control.selectedSegmentIndex = ClipMode.allCases.firstIndex(of: selectedMode) ?? UISegmentedControl.noSegment
  }

  final class Coordinator: NSObject {
    var onSelect: (ClipMode) -> Void

    init(onSelect: @escaping (ClipMode) -> Void) {
      self.onSelect = onSelect
    }

    @objc func valueChanged(_ sender: UISegmentedControl) {
      guard ClipMode.allCases.indices.contains(sender.selectedSegmentIndex) else { return }
      onSelect(ClipMode.allCases[sender.selectedSegmentIndex])
    }
  }
}

private enum LiquidGlassIntensity {
  case soft
  case medium
  case strong

  var fillOpacity: Double {
    switch self {
    case .soft: return 0.10
    case .medium: return 0.14
    case .strong: return 0.24
    }
  }

  var strokeOpacity: Double {
    switch self {
    case .soft: return 0.34
    case .medium: return 0.42
    case .strong: return 0.56
    }
  }

  var shadowOpacity: Double {
    switch self {
    case .soft: return 0.18
    case .medium: return 0.22
    case .strong: return 0.28
    }
  }
}

private extension View {
  func liquidGlassSurface<GlassShape: InsettableShape>(
    shape: GlassShape,
    intensity: LiquidGlassIntensity = .medium,
    isActive: Bool = false
  ) -> some View {
    self
      .background {
        shape
          .fill(.ultraThinMaterial.opacity(isActive ? 0.30 : 0.22))
          .overlay {
            shape.fill(Color.white.opacity(isActive ? intensity.fillOpacity + 0.12 : intensity.fillOpacity))
          }
      }
      .overlay(alignment: .topLeading) {
        shape
          .fill(
            LinearGradient(
              colors: [
                .white.opacity(isActive ? 0.34 : 0.24),
                .white.opacity(0.05),
                .clear,
              ],
              startPoint: .topLeading,
              endPoint: .bottomTrailing
            )
          )
          .blendMode(.screen)
      }
      .overlay {
        shape.stroke(.white.opacity(intensity.strokeOpacity), lineWidth: 1)
      }
      .overlay {
        shape
          .inset(by: 1.5)
          .stroke(.black.opacity(0.10), lineWidth: 1)
          .blendMode(.overlay)
      }
      .shadow(color: .black.opacity(intensity.shadowOpacity), radius: isActive ? 18 : 14, x: 0, y: isActive ? 8 : 6)
  }
}

private struct SmallControlButton: View {
  let title: String
  let meta: String
  let isActive: Bool
  var isDisabled = false
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(spacing: 3) {
        Text(title)
          .font(.system(size: 13, weight: .heavy))
        Text(meta)
          .font(.system(size: 11, weight: .bold))
          .opacity(0.68)
      }
      .frame(maxWidth: .infinity, minHeight: 58)
      .foregroundStyle(isActive ? .black : .white)
      .liquidGlassSurface(
        shape: RoundedRectangle(cornerRadius: 18, style: .continuous),
        intensity: isActive ? .strong : .medium,
        isActive: isActive
      )
    }
    .buttonStyle(.plain)
    .disabled(isDisabled)
    .opacity(isDisabled ? 0.48 : 1)
  }
}

private struct SettingToggle: View {
  let title: String
  let text: String
  let isOn: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 3) {
          Text(title)
            .font(.system(size: 13, weight: .heavy))
            .foregroundStyle(.white)
          Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.white.opacity(0.58))
            .lineLimit(2)
        }
        Spacer(minLength: 8)
        Toggle("", isOn: .constant(isOn))
          .labelsHidden()
          .allowsHitTesting(false)
      }
      .padding(12)
      .liquidGlassSurface(shape: RoundedRectangle(cornerRadius: 18, style: .continuous), intensity: .medium, isActive: isOn)
    }
    .buttonStyle(.plain)
  }
}

private struct ToggleButton: View {
  let title: String
  let symbol: String
  let isOn: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Label(title, systemImage: symbol)
        .font(.system(size: 14, weight: .semibold))
        .frame(maxWidth: .infinity, minHeight: 44)
        .foregroundStyle(isOn ? .black : .white)
        .liquidGlassSurface(
          shape: RoundedRectangle(cornerRadius: 14, style: .continuous),
          intensity: isOn ? .strong : .medium,
          isActive: isOn
        )
    }
    .buttonStyle(.plain)
  }
}

private struct ZoomSlider: View {
  let factor: CGFloat
  let onChange: (CGFloat) -> Void

  var body: some View {
    VStack(spacing: 8) {
      HStack(spacing: 10) {
        Image(systemName: "minus.magnifyingglass")
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(.white.opacity(0.72))
        Slider(value: Binding(get: {
          Double(factor)
        }, set: { value in
          onChange(CGFloat(value))
        }), in: 1...4)
        Image(systemName: "plus.magnifyingglass")
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(.white.opacity(0.72))
      }
      .padding(.horizontal, 4)

      HStack {
        Text("Zoom")
          .font(.system(size: 12, weight: .bold))
          .foregroundStyle(.white.opacity(0.66))
        Spacer()
        Text(formatZoom(factor))
          .font(.system(size: 12, weight: .heavy, design: .rounded))
          .foregroundStyle(.white)
          .padding(.horizontal, 10)
          .padding(.vertical, 4)
          .liquidGlassSurface(shape: Capsule(), intensity: .medium)
      }
    }
    .frame(minHeight: 56)
    .accessibilityLabel("Zoom")
    .accessibilityValue(formatZoom(factor))
  }
}

private struct ViewfinderBackground: View {
  @ObservedObject var model: ClipModel

  var body: some View {
    ZStack {
      if showsCameraFeed {
        CameraPreview(camera: model.camera)
          .ignoresSafeArea()
      } else {
        modeBackdrop
      }

      if model.mode == .ocr, let textCapture = model.textCapture {
        TextCaptureReview(
          capture: textCapture,
          showsCleanedImage: model.textCaptureShowsCleanedImage
        )
        .ignoresSafeArea()
        .transition(.opacity)
      } else if model.mode == .ocr, model.isExtractingText {
        extractionBackdrop
      }

      if model.mode == .barcode || model.isPairing {
        BarcodeOverlay(candidate: model.barcodeCandidate)
          .ignoresSafeArea()
      }
    }
  }

  private var showsCameraFeed: Bool {
    model.mode != .dictation && !model.isExtractingText && model.textCapture == nil
  }

  private var modeBackdrop: some View {
    LinearGradient(
      colors: [
        .black,
        backdropAccent,
      ],
      startPoint: .top,
      endPoint: .bottom
    )
    .ignoresSafeArea()
    .overlay {
      Image(systemName: model.mode.symbol)
        .font(.system(size: 118, weight: .thin))
        .foregroundStyle(.white.opacity(0.14))
    }
  }

  private var extractionBackdrop: some View {
    VStack(spacing: 16) {
      ProgressView()
        .tint(.white)
      Text("Extracting text")
        .font(.system(size: 16, weight: .semibold))
        .foregroundStyle(.white.opacity(0.74))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(.black.opacity(0.36))
    .ignoresSafeArea()
  }

  private var backdropAccent: Color {
    switch model.mode {
    case .ocr: return Color(red: 0.08, green: 0.13, blue: 0.16)
    case .barcode: return Color(red: 0.07, green: 0.15, blue: 0.12)
    case .photo: return Color(red: 0.13, green: 0.10, blue: 0.14)
    case .dictation: return Color(red: 0.10, green: 0.12, blue: 0.16)
    }
  }
}

private struct TextCapture {
  let originalImage: UIImage
  let cleanedImage: UIImage
}

private struct TextCaptureReview: UIViewRepresentable {
  let capture: TextCapture
  let showsCleanedImage: Bool

  func makeUIView(context: Context) -> LiveTextCaptureView {
    let view = LiveTextCaptureView()
    view.setCapture(capture, showsCleanedImage: showsCleanedImage, animated: false)
    return view
  }

  func updateUIView(_ uiView: LiveTextCaptureView, context: Context) {
    uiView.setCapture(capture, showsCleanedImage: showsCleanedImage, animated: true)
  }
}

private final class LiveTextCaptureView: UIView {
  private let imageView = UIImageView()
  private var analyzer: Any?
  private var interaction: Any?
  private var analysisTask: Task<Void, Never>?
  private var currentImageIdentifier = ""

  override init(frame: CGRect) {
    super.init(frame: frame)
    setup()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setup()
  }

  deinit {
    analysisTask?.cancel()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    imageView.frame = bounds
  }

  func setCapture(_ capture: TextCapture, showsCleanedImage: Bool, animated: Bool) {
    let image = showsCleanedImage ? capture.cleanedImage : capture.originalImage
    let identifier = "\(ObjectIdentifier(image))-\(showsCleanedImage)"
    guard identifier != currentImageIdentifier else { return }
    currentImageIdentifier = identifier

    if animated {
      UIView.transition(with: imageView, duration: 0.36, options: [.transitionCrossDissolve, .allowUserInteraction]) {
        self.imageView.image = image
      }
    } else {
      imageView.image = image
    }

    if showsCleanedImage {
      analyze(image)
    }
  }

  private func setup() {
    backgroundColor = .black
    clipsToBounds = true
    imageView.contentMode = .scaleAspectFill
    imageView.isUserInteractionEnabled = true
    addSubview(imageView)

    if #available(iOS 16.0, *) {
      let liveTextInteraction = ImageAnalysisInteraction()
      liveTextInteraction.preferredInteractionTypes = .textSelection
      liveTextInteraction.allowLongPressForDataDetectorsInTextMode = false
      imageView.addInteraction(liveTextInteraction)
      interaction = liveTextInteraction
      analyzer = ImageAnalyzer()
    }
  }

  private func analyze(_ image: UIImage) {
    guard #available(iOS 16.0, *) else { return }
    guard let analyzer = analyzer as? ImageAnalyzer, let interaction = interaction as? ImageAnalysisInteraction else { return }

    analysisTask?.cancel()
    analysisTask = Task {
      do {
        let analysis = try await analyzer.analyze(image, configuration: ImageAnalyzer.Configuration([.text]))
        await MainActor.run {
          guard !Task.isCancelled else { return }
          interaction.analysis = analysis
          interaction.preferredInteractionTypes = .textSelection
          interaction.allowLongPressForDataDetectorsInTextMode = false
        }
      } catch {
        await MainActor.run {
          interaction.analysis = nil
        }
      }
    }
  }
}

private struct CameraPreview: UIViewRepresentable {
  let camera: ClipCamera

  func makeUIView(context: Context) -> PreviewView {
    let view = PreviewView(camera: camera)
    view.previewLayer.session = camera.session
    camera.attachPreviewView(view)
    return view
  }

  func updateUIView(_ uiView: PreviewView, context: Context) {
    uiView.previewLayer.session = camera.session
    uiView.camera = camera
    camera.attachPreviewView(uiView)
  }
}

private final class PreviewView: UIView {
  override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
  var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
  weak var camera: ClipCamera?
  private let focusRing = UIView()

  init(camera: ClipCamera) {
    self.camera = camera
    super.init(frame: .zero)
    setup()
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    setup()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setup()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    camera?.updateRectOfInterest(from: previewLayer)
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let point = touches.first?.location(in: self) else { return }
    let devicePoint = previewLayer.captureDevicePointConverted(fromLayerPoint: point)
    camera?.focus(at: devicePoint)
    showFocusRing(at: point)
  }

  private func setup() {
    previewLayer.videoGravity = .resizeAspectFill
    backgroundColor = .black
    isMultipleTouchEnabled = false

    focusRing.isUserInteractionEnabled = false
    focusRing.alpha = 0
    focusRing.layer.borderWidth = 2
    focusRing.layer.borderColor = UIColor.white.withAlphaComponent(0.92).cgColor
    focusRing.layer.cornerRadius = 34
    focusRing.layer.cornerCurve = .continuous
    addSubview(focusRing)
  }

  private func showFocusRing(at point: CGPoint) {
    focusRing.bounds = CGRect(x: 0, y: 0, width: 68, height: 68)
    focusRing.center = point
    focusRing.transform = CGAffineTransform(scaleX: 1.18, y: 1.18)
    focusRing.alpha = 0.95

    UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseOut, .allowUserInteraction]) {
      self.focusRing.transform = .identity
    } completion: { _ in
      UIView.animate(withDuration: 0.34, delay: 0.42, options: [.curveEaseIn, .allowUserInteraction]) {
        self.focusRing.alpha = 0
      }
    }
  }
}

private struct BarcodeOverlay: View {
  let candidate: BarcodeCandidate?

  var body: some View {
    GeometryReader { proxy in
      if let candidate {
        if candidate.previewCorners.count >= 4 {
          Path { path in
            let points = candidate.previewCorners.map { $0.point(in: proxy.size) }
            path.move(to: points[0])
            for point in points.dropFirst() {
              path.addLine(to: point)
            }
            path.closeSubpath()
          }
          .stroke(.green, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
          .shadow(color: .green.opacity(0.65), radius: 10)
        } else {
          let rect = candidate.rect(in: proxy.size)
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(.green, lineWidth: 4)
            .frame(width: rect.width, height: rect.height)
            .position(x: rect.midX, y: rect.midY)
            .shadow(color: .green.opacity(0.65), radius: 10)
        }
      }
    }
    .allowsHitTesting(false)
  }
}

private struct NormalizedPoint {
  let x: CGFloat
  let y: CGFloat

  func point(in size: CGSize) -> CGPoint {
    CGPoint(x: x * size.width, y: y * size.height)
  }
}

private struct CapturedPhoto {
  let data: Data
  let image: CGImage
  let uiImage: UIImage
  let size: CGSize
}

private struct BarcodeCandidate: Identifiable {
  let id = UUID()
  let value: String
  let format: String
  let previewBounds: CGRect
  let previewCorners: [NormalizedPoint]

  func rect(in size: CGSize) -> CGRect {
    CGRect(
      x: previewBounds.minX * size.width,
      y: previewBounds.minY * size.height,
      width: previewBounds.width * size.width,
      height: previewBounds.height * size.height
    )
  }
}

private func nearestZoomStopIndex(to factor: CGFloat) -> Int {
  var bestIndex = 0
  var bestDistance = CGFloat.greatestFiniteMagnitude
  for (index, stop) in clipZoomStops.enumerated() {
    let distance = abs(stop - factor)
    if distance < bestDistance {
      bestDistance = distance
      bestIndex = index
    }
  }
  return bestIndex
}

private func nearestZoomStop(to factor: CGFloat) -> CGFloat {
  clipZoomStops[nearestZoomStopIndex(to: factor)]
}

private func formatZoom(_ factor: CGFloat) -> String {
  factor.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(factor))x" : String(format: "%.1fx", Double(factor))
}

private func clampedUnit(_ value: CGFloat) -> CGFloat {
  max(0, min(1, value))
}

private final class ClipCamera: NSObject, ObservableObject, AVCaptureMetadataOutputObjectsDelegate, AVCapturePhotoCaptureDelegate {
  let session = AVCaptureSession()
  var onBarcode: ((BarcodeCandidate) -> Void)?
  var onBarcodeLost: (() -> Void)?

  private let queue = DispatchQueue(label: "com.volt.clip.native.camera")
  private let photoOutput = AVCapturePhotoOutput()
  private let metadataOutput = AVCaptureMetadataOutput()
  private var device: AVCaptureDevice?
  private var isConfigured = false
  private var completion: ((Result<CapturedPhoto, Error>) -> Void)?
  private weak var previewView: PreviewView?
  private var barcodeFullFrame = false

  @MainActor
  func attachPreviewView(_ view: PreviewView) {
    previewView = view
    updateRectOfInterest(from: view.previewLayer)
  }

  func start() {
    AVCaptureDevice.requestAccess(for: .video) { granted in
      guard granted else { return }
      self.queue.async {
        do {
          try self.configureIfNeeded()
          if !self.session.isRunning {
            self.session.startRunning()
          }
        } catch {
          // Surface is handled by capture actions.
        }
      }
    }
  }

  func stop() {
    queue.async {
      if self.session.isRunning {
        self.session.stopRunning()
      }
    }
  }

  func setMode(_ mode: ClipMode) {
    queue.async {
      self.metadataOutput.setMetadataObjectsDelegate(mode == .barcode ? self : nil, queue: DispatchQueue.main)
    }
  }

  func setBarcodeFullFrame(_ enabled: Bool) {
    barcodeFullFrame = enabled
    queue.async {
      self.metadataOutput.rectOfInterest = enabled ? CGRect(x: 0, y: 0, width: 1, height: 1) : CGRect(x: 0.18, y: 0.18, width: 0.64, height: 0.64)
      DispatchQueue.main.async {
        if let previewLayer = self.previewView?.previewLayer {
          self.updateRectOfInterest(from: previewLayer)
        }
      }
    }
  }

  @MainActor
  func updateRectOfInterest(from previewLayer: AVCaptureVideoPreviewLayer) {
    guard isConfigured else { return }
    let rect: CGRect
    if barcodeFullFrame || previewLayer.bounds.isEmpty {
      rect = CGRect(x: 0, y: 0, width: 1, height: 1)
    } else {
      let layerBounds = previewLayer.bounds
      let side = min(layerBounds.width, layerBounds.height) * 0.64
      let scanRect = CGRect(
        x: layerBounds.midX - side / 2,
        y: layerBounds.midY - side / 2,
        width: side,
        height: side
      )
      rect = previewLayer.metadataOutputRectConverted(fromLayerRect: scanRect)
    }

    let metadataOutput = metadataOutput
    queue.async {
      metadataOutput.rectOfInterest = rect
    }
  }

  func focus(at devicePoint: CGPoint) {
    queue.async {
      guard let device = self.device else { return }
      guard (try? device.lockForConfiguration()) != nil else { return }
      defer { device.unlockForConfiguration() }
      if device.isFocusPointOfInterestSupported {
        device.focusPointOfInterest = devicePoint
        device.focusMode = device.isFocusModeSupported(.autoFocus) ? .autoFocus : .continuousAutoFocus
      }
      if device.isExposurePointOfInterestSupported {
        device.exposurePointOfInterest = devicePoint
        device.exposureMode = device.isExposureModeSupported(.continuousAutoExposure) ? .continuousAutoExposure : .autoExpose
      }
    }
  }

  func setTorch(_ enabled: Bool) {
    queue.async {
      guard let device = self.device, device.hasTorch else { return }
      try? device.lockForConfiguration()
      device.torchMode = enabled ? .on : .off
      device.unlockForConfiguration()
    }
  }

  func setZoom(_ factor: CGFloat) {
    queue.async {
      guard let device = self.device else { return }
      let value = max(device.minAvailableVideoZoomFactor, min(factor, min(4, device.activeFormat.videoMaxZoomFactor)))
      try? device.lockForConfiguration()
      device.videoZoomFactor = value
      device.unlockForConfiguration()
    }
  }

  func capturePhoto(completion: @escaping (Result<CapturedPhoto, Error>) -> Void) {
    AVCaptureDevice.requestAccess(for: .video) { granted in
      guard granted else {
        completion(.failure(ClipError.message("Camera permission is required.")))
        return
      }
      self.queue.async {
        do {
          try self.configureIfNeeded()
          self.completion = completion
          if !self.session.isRunning {
            self.session.startRunning()
          }
          self.photoOutput.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
        } catch {
          completion(.failure(error))
        }
      }
    }
  }

  private func configureIfNeeded() throws {
    guard !isConfigured else { return }
    guard
      let device = AVCaptureDevice.default(.builtInTripleCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(.builtInDualWideCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
    else {
      throw ClipError.message("Camera is unavailable.")
    }

    let input = try AVCaptureDeviceInput(device: device)
    session.beginConfiguration()
    session.sessionPreset = .photo
    if session.canAddInput(input) { session.addInput(input) }
    if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }
    if session.canAddOutput(metadataOutput) {
      session.addOutput(metadataOutput)
      metadataOutput.metadataObjectTypes = supportedTypes(metadataOutput.availableMetadataObjectTypes)
    }
    session.commitConfiguration()
    self.device = device
    isConfigured = true
    DispatchQueue.main.async {
      if let previewLayer = self.previewView?.previewLayer {
        self.updateRectOfInterest(from: previewLayer)
      }
    }
  }

  private func supportedTypes(_ available: [AVMetadataObject.ObjectType]) -> [AVMetadataObject.ObjectType] {
    [.qr, .ean13, .ean8, .upce, .code128, .code39, .code93, .dataMatrix, .pdf417, .aztec, .interleaved2of5, .itf14]
      .filter { available.contains($0) }
  }

  func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
    guard
      let object = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first,
      let value = object.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
      !value.isEmpty
    else {
      onBarcodeLost?()
      return
    }

    let overlay = normalizedPreviewOverlay(for: object)
    onBarcode?(
      BarcodeCandidate(
        value: value,
        format: metadataName(object.type),
        previewBounds: overlay.bounds,
        previewCorners: overlay.corners
      )
    )
  }

  private func normalizedPreviewOverlay(for object: AVMetadataMachineReadableCodeObject) -> (bounds: CGRect, corners: [NormalizedPoint]) {
    guard let previewView, !previewView.bounds.isEmpty else {
      return (
        CGRect(
          x: max(0, min(1, object.bounds.origin.x)),
          y: max(0, min(1, object.bounds.origin.y)),
          width: max(0.06, min(1, object.bounds.width)),
          height: max(0.06, min(1, object.bounds.height))
        ),
        []
      )
    }

    let transformed = previewView.previewLayer.transformedMetadataObject(for: object) as? AVMetadataMachineReadableCodeObject
    let bounds = transformed?.bounds ?? .null
    guard !bounds.isNull, !bounds.isEmpty else {
      return (CGRect(x: 0.47, y: 0.47, width: 0.06, height: 0.06), [])
    }

    let viewBounds = previewView.bounds
    let clipped = bounds.intersection(viewBounds)
    guard !clipped.isNull, !clipped.isEmpty else {
      return (CGRect(x: 0.47, y: 0.47, width: 0.06, height: 0.06), [])
    }

    let normalizedBounds = CGRect(
      x: clampedUnit(clipped.minX / viewBounds.width),
      y: clampedUnit(clipped.minY / viewBounds.height),
      width: max(0.02, min(1, clipped.width / viewBounds.width)),
      height: max(0.02, min(1, clipped.height / viewBounds.height))
    )

    let corners = (transformed?.corners ?? [])
      .map { point in
        NormalizedPoint(
          x: clampedUnit(point.x / viewBounds.width),
          y: clampedUnit(point.y / viewBounds.height)
        )
      }

    return (normalizedBounds, corners.count >= 4 ? corners : [])
  }

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    if let error {
      completion?(.failure(error))
      completion = nil
      return
    }
    guard
      let data = photo.fileDataRepresentation(),
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
      completion?(.failure(ClipError.message("Unable to read the photo.")))
      completion = nil
      return
    }
    let uiImage = UIImage(cgImage: image, scale: 1, orientation: .right)
    completion?(.success(CapturedPhoto(data: data, image: image, uiImage: uiImage, size: CGSize(width: image.width, height: image.height))))
    completion = nil
  }

  private func metadataName(_ type: AVMetadataObject.ObjectType) -> String {
    switch type {
    case .qr: return "qr"
    case .ean13: return "ean13"
    case .ean8: return "ean8"
    case .upce: return "upce"
    case .code128: return "code128"
    case .code39: return "code39"
    case .code93: return "code93"
    case .dataMatrix: return "datamatrix"
    case .pdf417: return "pdf417"
    case .aztec: return "aztec"
    case .interleaved2of5: return "itf"
    case .itf14: return "itf14"
    default: return type.rawValue
    }
  }
}

private enum TextRecognizer {
  static func recognize(cgImage: CGImage) async throws -> String {
    try await withCheckedThrowingContinuation { continuation in
      let request = VNRecognizeTextRequest { request, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        let observations = request.results as? [VNRecognizedTextObservation] ?? []
        let text = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        continuation.resume(returning: text)
      }
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try VNImageRequestHandler(cgImage: cgImage, orientation: .right).perform([request])
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }
}

private struct EnhancedTextImage {
  let cgImage: CGImage
  let uiImage: UIImage
}

private enum TextImageEnhancer {
  static func cleanedImage(from image: CGImage) async throws -> EnhancedTextImage {
    try await Task.detached(priority: .userInitiated) {
      let context = CIContext(options: nil)
      let inputImage = CIImage(cgImage: image)

      let noiseReduction = CIFilter.noiseReduction()
      noiseReduction.inputImage = inputImage
      noiseReduction.noiseLevel = 0.02
      noiseReduction.sharpness = 0.55

      let colorControls = CIFilter.colorControls()
      colorControls.inputImage = noiseReduction.outputImage ?? inputImage
      colorControls.brightness = 0.02
      colorControls.contrast = 1.22
      colorControls.saturation = 0.92

      let sharpen = CIFilter.sharpenLuminance()
      sharpen.inputImage = colorControls.outputImage ?? inputImage
      sharpen.sharpness = 0.55

      guard
        let outputImage = sharpen.outputImage,
        let cgImage = context.createCGImage(outputImage, from: outputImage.extent)
      else {
        throw ClipError.message("Unable to clean up the captured image.")
      }

      return EnhancedTextImage(
        cgImage: cgImage,
        uiImage: UIImage(cgImage: cgImage, scale: 1, orientation: .right)
      )
    }.value
  }
}

private final class ClipDictation: NSObject {
  let sessionId = UUID().uuidString
  var onPartial: ((String) -> Void)?
  var onFinal: ((String) -> Void)?

  private let audioEngine = AVAudioEngine()
  private var webSocket: URLSessionWebSocketTask?
  private var transcript = ""
  private var completedTranscript = ""
  private let dictationTokenURL = URL(string: "https://scanner-signal.vercel.app/api/dictation-token")!
  private let realtimeURL = URL(string: "wss://api.openai.com/v1/realtime?intent=transcription")!

  func start(sessionId browserSessionId: String) async throws {
    try await requestPermissions()
    stop()
    transcript = ""
    completedTranscript = ""

    let token = try await fetchEphemeralToken(browserSessionId: browserSessionId)
    try openRealtimeStream(ephemeralToken: token)

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker, .allowBluetoothHFP])
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
      self?.sendAudioChunk(buffer: buffer, format: format)
    }

    audioEngine.prepare()
    try audioEngine.start()
  }

  func stop() {
    webSocket?.send(.string(#"{"type":"input_audio_buffer.commit"}"#)) { _ in }
    if audioEngine.isRunning {
      audioEngine.stop()
    }
    audioEngine.inputNode.removeTap(onBus: 0)
    webSocket?.cancel(with: .normalClosure, reason: nil)
    webSocket = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  func finishAndStop(timeout: TimeInterval) async -> String? {
    webSocket?.send(.string(#"{"type":"input_audio_buffer.commit"}"#)) { _ in }
    if audioEngine.isRunning {
      audioEngine.stop()
    }
    audioEngine.inputNode.removeTap(onBus: 0)

    let completed = await waitForFinalTranscript(timeout: timeout)
    webSocket?.cancel(with: .normalClosure, reason: nil)
    webSocket = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

    let completedValue = completed?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return completedValue.isEmpty ? nil : completedValue
  }

  private func waitForFinalTranscript(timeout: TimeInterval) async -> String? {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      let completed = completedTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
      if !completed.isEmpty {
        return completed
      }
      try? await Task.sleep(nanoseconds: 80_000_000)
    }
    let partial = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    return partial.isEmpty ? nil : partial
  }

  private func requestPermissions() async throws {
    let micGranted = await withCheckedContinuation { continuation in
      if #available(iOS 17.0, *) {
        AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
      } else {
        AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
      }
    }
    guard micGranted else {
      throw ClipError.message("Microphone permission is required.")
    }
  }

  private func fetchEphemeralToken(browserSessionId: String) async throws -> String {
    var request = URLRequest(url: dictationTokenURL)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "sessionId": browserSessionId,
      "dictationSessionId": sessionId,
    ])

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
      throw ClipError.message("Streaming dictation service is unavailable.")
    }

    let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    guard let value = payload?["value"] as? String, !value.isEmpty else {
      throw ClipError.message("Streaming dictation service is unavailable.")
    }
    return value
  }

  private func openRealtimeStream(ephemeralToken: String) throws {
    var request = URLRequest(url: realtimeURL)
    request.setValue("Bearer \(ephemeralToken)", forHTTPHeaderField: "Authorization")
    request.setValue("realtime=v1", forHTTPHeaderField: "OpenAI-Beta")

    let socket = URLSession.shared.webSocketTask(with: request)
    webSocket = socket
    socket.resume()
    socket.send(.string("""
      {"type":"session.update","session":{"type":"transcription","audio":{"input":{"format":{"type":"audio/pcm","rate":24000},"noise_reduction":{"type":"near_field"},"transcription":{"model":"gpt-4o-transcribe","language":"en"},"turn_detection":null}}}}
      """)) { _ in }
    receiveRealtimeMessages(from: socket)
  }

  private func receiveRealtimeMessages(from socket: URLSessionWebSocketTask) {
    socket.receive { [weak self, weak socket] result in
      guard let self, let socket, self.webSocket === socket else { return }
      if case .success(.string(let text)) = result {
        self.handleRealtimeMessage(text)
      }
      self.receiveRealtimeMessages(from: socket)
    }
  }

  private func handleRealtimeMessage(_ text: String) {
    guard
      let data = text.data(using: .utf8),
      let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let type = message["type"] as? String
    else { return }

    if type == "conversation.item.input_audio_transcription.delta", let delta = message["delta"] as? String {
      transcript += delta
      onPartial?(transcript)
    } else if type == "conversation.item.input_audio_transcription.completed", let final = message["transcript"] as? String {
      transcript = final
      completedTranscript = final
      onFinal?(final)
    }
  }

  private func sendAudioChunk(buffer: AVAudioPCMBuffer, format: AVAudioFormat) {
    guard let channelData = buffer.floatChannelData, let webSocket else { return }
    let frameCount = Int(buffer.frameLength)
    let channelCount = max(1, Int(format.channelCount))
    guard frameCount > 0 else { return }

    let outputSampleRate: Double = 24000
    let inputSampleRate = max(format.sampleRate, outputSampleRate)
    let outputFrameCount = max(1, Int(Double(frameCount) * outputSampleRate / inputSampleRate))
    var data = Data(capacity: outputFrameCount * 2)

    for outputFrame in 0..<outputFrameCount {
      let frame = min(frameCount - 1, Int(Double(outputFrame) * inputSampleRate / outputSampleRate))
      var sample: Float = 0
      for channel in 0..<min(channelCount, Int(buffer.format.channelCount)) {
        sample += channelData[channel][frame]
      }
      sample /= Float(channelCount)
      let clamped = max(-1, min(1, sample))
      let intSample = Int16(clamped * Float(Int16.max))
      data.append(UInt8(truncatingIfNeeded: intSample))
      data.append(UInt8(truncatingIfNeeded: intSample >> 8))
    }

    let payload = #"{"type":"input_audio_buffer.append","audio":"\#(data.base64EncodedString())"}"#
    webSocket.send(.string(payload)) { _ in }
  }
}

private struct ClipHTTPStatusError: Error {
  let statusCode: Int
}

private enum ClipError: LocalizedError {
  case message(String)

  var errorDescription: String? {
    switch self {
    case .message(let message): return message
    }
  }
}
