@preconcurrency import AVFoundation
import CoreMedia
import Foundation
import Observation
import Speech

@MainActor
@Observable
final class SpeechDictationService {
    enum Authorization {
        case notDetermined
        case denied
        case restricted
        case authorized
    }

    /// Where the microphone pipeline actually is, so the UI can tell people when it
    /// is safe to speak and when it is safe to stop. People start talking the instant
    /// they tap, and let go on the tail of the last word — both ends need a signal.
    enum Phase: Equatable {
        /// Nothing running.
        case idle
        /// Permissions, model assets, and the audio graph are still coming up.
        case preparing
        /// The microphone is live and audio is reaching the analyzer.
        case listening
        /// Stop was requested; the tail of the audio is still being drained.
        case finishing
    }

    var authorization: Authorization = .notDetermined
    var phase: Phase = .idle
    var transcript = ""
    var errorMessage: String?
    /// Smoothed 0...1 microphone level, so the UI can show that speech is landing.
    var inputLevel: Double = 0

    var isListening: Bool { phase == .listening }
    var isPreparing: Bool { phase == .preparing }
    var isFinishing: Bool { phase == .finishing }
    var isActive: Bool { phase != .idle }

    private let audioEngine = AVAudioEngine()
    private var analyzer: SpeechAnalyzer?
    private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?
    private var analysisTask: Task<Void, Never>?
    private var resultsTask: Task<Void, Never>?
    private var readinessWatchdog: Task<Void, Never>?
    private var transcriptHandler: ((String) -> Void)?
    private var finalizedText = ""
    private var volatileText = ""
    private var isTapInstalled = false
    private var isSessionActive = false
    private var interruptionObserver: NSObjectProtocol?
    /// Bumped by every start and every teardown. Bringing the pipeline up spans several
    /// awaits (asset download, analyzer prep); if the user leaves the tab in that window
    /// the in-flight start has to notice and abandon instead of starting an engine
    /// nobody is left holding.
    private var generation = 0

    /// How long the microphone stays open after Stop. People release on the tail of
    /// their last word; cutting the tap at that instant is what eats it.
    private static let tailCaptureDuration = Duration.milliseconds(600)
    /// Longest we block the UI waiting for the analyzer to hand back final results.
    private static let finalizationTimeout: Duration = .seconds(4)
    /// If the tap never fires, the microphone is wedged — fail loudly instead of
    /// leaving the user talking into a dead session.
    private static let readinessTimeout: Duration = .seconds(6)

    var isAvailable: Bool { true }

    func requestAuthorizations() async -> Authorization {
        let recordPermission = AVAudioApplication.shared.recordPermission
        let microphoneGranted: Bool
        switch recordPermission {
        case .granted:
            microphoneGranted = true
        case .denied:
            microphoneGranted = false
        case .undetermined:
            microphoneGranted = await AVAudioApplication.requestRecordPermission()
        @unknown default:
            microphoneGranted = false
        }

        let next: Authorization = microphoneGranted ? .authorized : .denied
        authorization = next
        if next != .authorized {
            errorMessage = authorizationMessage(for: next)
        }
        return next
    }

    func start(onTranscriptChange: @escaping (String) -> Void) async {
        // Starting twice would install a second tap on bus 0 and strand the first
        // analyzer. `start` awaits an asset download, so a double tap is easy to hit.
        guard phase == .idle else { return }
        phase = .preparing
        errorMessage = nil
        transcriptHandler = onTranscriptChange
        finalizedText = ""
        volatileText = ""
        transcript = ""
        inputLevel = 0
        generation += 1
        let token = generation

        guard await requestAuthorizations() == .authorized else {
            await teardown(clearTranscript: true)
            return
        }

        do {
            try await beginCapture(token: token)
        } catch is CancellationError {
            // Superseded by a cancel or a second start; that path owns the teardown.
        } catch {
            errorMessage = describe(error)
            await teardown(clearTranscript: true)
        }
    }

    /// Stops listening and returns the finished transcript, including the tail that
    /// is still in flight when the button is tapped.
    @discardableResult
    func stop() async -> String {
        guard phase == .preparing || phase == .listening else {
            return transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        phase = .finishing
        readinessWatchdog?.cancel()
        readinessWatchdog = nil

        try? await Task.sleep(for: Self.tailCaptureDuration)
        stopAudioCapture()

        // Ending the input stream and finalizing through end-of-input is what makes
        // the analyzer emit the last partial result as a final one.
        if let analyzer {
            try? await analyzer.finalizeAndFinishThroughEndOfInput()
        }
        await awaitCompletion(of: analysisTask)
        await awaitCompletion(of: resultsTask)

        await teardown(clearTranscript: false)
        return transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func cancel() async {
        await teardown(clearTranscript: true)
        errorMessage = nil
    }

    func clearTranscript() {
        transcript = ""
        finalizedText = ""
        volatileText = ""
    }

    // MARK: - Capture

    private func beginCapture(token: Int) async throws {
        func checkStillCurrent() throws {
            guard generation == token else { throw CancellationError() }
        }

        guard let locale = await DictationTranscriber.supportedLocale(
            equivalentTo: .autoupdatingCurrent
        ) else {
            throw SpeechDictationError.unsupportedLocale
        }
        try checkStillCurrent()
        let transcriber = DictationTranscriber(
            locale: locale,
            contentHints: [.shortForm],
            transcriptionOptions: [.punctuation],
            reportingOptions: [.volatileResults, .frequentFinalization],
            attributeOptions: []
        )
        if let installation = try await AssetInventory.assetInstallationRequest(
            supporting: [transcriber]
        ) {
            try await installation.downloadAndInstall()
        }
        try checkStillCurrent()

        // Activate the session before touching `inputNode`: the engine latches the
        // hardware format the first time that node is created, and a node created
        // against an inactive session reports a 0 Hz / 0 channel format that makes
        // `installTap(onBus:bufferSize:format:)` trap and take the app down.
        try activateAudioSession()

        let inputNode = audioEngine.inputNode
        let sourceFormat = inputNode.outputFormat(forBus: 0)
        guard sourceFormat.sampleRate > 0, sourceFormat.channelCount > 0 else {
            throw SpeechDictationError.microphoneUnavailable
        }

        guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
            compatibleWith: [transcriber],
            considering: sourceFormat
        ) else {
            throw SpeechDictationError.audioFormatUnavailable
        }
        try checkStillCurrent()
        let converter = try SpeechAnalyzerInputConverter(
            sourceFormat: sourceFormat,
            analyzerFormat: analyzerFormat
        )

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        try await analyzer.prepareToAnalyze(in: analyzerFormat)
        // Last gate before anything becomes the service's responsibility to shut down.
        do {
            try checkStillCurrent()
        } catch {
            await analyzer.cancelAndFinishNow()
            throw error
        }
        self.analyzer = analyzer

        let (inputStream, continuation) = AsyncStream.makeStream(
            of: AnalyzerInput.self,
            bufferingPolicy: .bufferingNewest(512)
        )
        inputContinuation = continuation

        resultsTask = Task { [weak self] in
            do {
                for try await result in transcriber.results {
                    guard !Task.isCancelled else { return }
                    self?.apply(result)
                }
            } catch {
                guard !Task.isCancelled else { return }
                self?.reportFailure(error)
            }
        }
        analysisTask = Task { [weak self] in
            do {
                _ = try await analyzer.analyzeSequence(inputStream)
            } catch {
                guard !Task.isCancelled else { return }
                self?.reportFailure(error)
            }
        }

        inputNode.removeTap(onBus: 0)
        let tapHandler = Self.makeAudioTapHandler(
            converter: converter,
            continuation: continuation,
            service: self
        )
        inputNode.installTap(
            onBus: 0,
            bufferSize: 2_048,
            format: sourceFormat,
            block: tapHandler
        )
        isTapInstalled = true

        audioEngine.prepare()
        try audioEngine.start()
        observeInterruptions()
        startReadinessWatchdog()
    }

    /// AVAudioEngine invokes tap blocks on its real-time audio thread. Building the
    /// block inside this nonisolated factory prevents Swift 6 from attaching the
    /// service's MainActor executor precondition to that callback.
    private nonisolated static func makeAudioTapHandler(
        converter: SpeechAnalyzerInputConverter,
        continuation: AsyncStream<AnalyzerInput>.Continuation,
        service: SpeechDictationService
    ) -> AVAudioNodeTapBlock {
        { [weak service] buffer, _ in
            let level = SpeechDictationService.meterLevel(of: buffer)
            do {
                for input in try converter.convert(buffer) {
                    continuation.yield(input)
                }
            } catch {
                continuation.finish()
            }
            Task { @MainActor [weak service] in
                service?.noteAudioArrived(level: level)
            }
        }
    }

    /// The first buffer off the tap is the honest "you can speak now" signal: it means
    /// the graph is running and the microphone is actually producing audio.
    private func noteAudioArrived(level: Double) {
        guard phase == .preparing || phase == .listening else { return }
        if phase == .preparing {
            phase = .listening
            readinessWatchdog?.cancel()
            readinessWatchdog = nil
        }
        inputLevel = max(level, inputLevel * 0.75)
    }

    private func startReadinessWatchdog() {
        readinessWatchdog?.cancel()
        readinessWatchdog = Task { [weak self] in
            try? await Task.sleep(for: SpeechDictationService.readinessTimeout)
            guard !Task.isCancelled, let self, self.phase == .preparing else { return }
            self.errorMessage = SpeechDictationError.microphoneUnavailable.errorDescription
            await self.teardown(clearTranscript: true)
        }
    }

    private func stopAudioCapture() {
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        // Only reach for `inputNode` when a tap was installed — the getter creates the
        // node, and doing that on a failure path where the session never came up is
        // exactly the situation that trips AVAudioEngine's format assertions.
        if isTapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            isTapInstalled = false
        }
        inputContinuation?.finish()
        inputContinuation = nil
        inputLevel = 0
    }

    private func teardown(clearTranscript: Bool) async {
        generation += 1
        readinessWatchdog?.cancel()
        readinessWatchdog = nil
        stopAudioCapture()

        analysisTask?.cancel()
        resultsTask?.cancel()
        if let analyzer {
            await analyzer.cancelAndFinishNow()
        }
        analysisTask = nil
        resultsTask = nil
        analyzer = nil
        transcriptHandler = nil
        stopObservingInterruptions()
        deactivateAudioSession()
        phase = .idle

        if clearTranscript {
            self.clearTranscript()
        }
    }

    // MARK: - Results

    private func apply(_ result: DictationTranscriber.Result) {
        let text = String(result.text.characters)
        if result.isFinal {
            finalizedText += text
            volatileText = ""
        } else {
            volatileText = text
        }

        let next = Self.normalized(finalizedText + volatileText)
        guard next != transcript else { return }
        transcript = next
        transcriptHandler?(next)
    }

    private func reportFailure(_ error: Error) {
        errorMessage = describe(error)
        Task { await teardown(clearTranscript: false) }
    }

    private static func normalized(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Audio session

    private func activateAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        // `.duckOthers` is only legal on playback-capable categories. Pairing it with
        // `.record` makes `setCategory` throw -50, which used to kill every start.
        try session.setCategory(.record, mode: .measurement, options: [.allowBluetoothHFP])
        try session.setActive(true, options: .notifyOthersOnDeactivation)
        isSessionActive = true
    }

    private func deactivateAudioSession() {
        guard isSessionActive else { return }
        isSessionActive = false
        try? AVAudioSession.sharedInstance().setActive(
            false,
            options: .notifyOthersOnDeactivation
        )
    }

    private func observeInterruptions() {
        stopObservingInterruptions()
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            guard
                let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                AVAudioSession.InterruptionType(rawValue: raw) == .began
            else { return }
            Task { @MainActor [weak self] in
                await self?.handleInterruption()
            }
        }
    }

    private func stopObservingInterruptions() {
        if let interruptionObserver {
            NotificationCenter.default.removeObserver(interruptionObserver)
        }
        interruptionObserver = nil
    }

    private func handleInterruption() async {
        guard phase == .preparing || phase == .listening else { return }
        errorMessage = SpeechDictationError.interrupted.errorDescription
        await teardown(clearTranscript: false)
    }

    // MARK: - Helpers

    /// Awaits a task but refuses to hang the UI on it — Stop has to feel finite even
    /// if the analyzer never reports back.
    private func awaitCompletion(of task: Task<Void, Never>?) async {
        guard let task else { return }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await task.value }
            group.addTask {
                try? await Task.sleep(for: SpeechDictationService.finalizationTimeout)
            }
            await group.next()
            group.cancelAll()
        }
    }

    private nonisolated static func meterLevel(of buffer: AVAudioPCMBuffer) -> Double {
        guard let channel = buffer.floatChannelData?.pointee, buffer.frameLength > 0 else {
            return 0
        }
        let frames = Int(buffer.frameLength)
        let stride = buffer.stride
        var sumOfSquares: Float = 0
        for frame in 0..<frames {
            let sample = channel[frame * stride]
            sumOfSquares += sample * sample
        }
        let rms = (sumOfSquares / Float(frames)).squareRoot()
        guard rms > 0 else { return 0 }
        // -50 dBFS reads as silence, 0 dBFS as full scale.
        let decibels = 20 * log10(Double(rms))
        return min(max((decibels + 50) / 50, 0), 1)
    }

    private func describe(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }

    private func authorizationMessage(for authorization: Authorization) -> String {
        switch authorization {
        case .authorized:
            ""
        case .notDetermined:
            "Allow microphone access to dictate."
        case .denied:
            "Enable microphone access in Settings to dictate."
        case .restricted:
            "Microphone access is restricted on this device."
        }
    }
}

private enum SpeechDictationError: LocalizedError {
    case unsupportedLocale
    case audioFormatUnavailable
    case audioConversionUnavailable
    case microphoneUnavailable
    case interrupted

    var errorDescription: String? {
        switch self {
        case .unsupportedLocale:
            "Dictation is unavailable for the current language."
        case .audioFormatUnavailable:
            "Dictation audio is unavailable on this device."
        case .audioConversionUnavailable:
            "The microphone audio format could not be prepared for dictation."
        case .microphoneUnavailable:
            "The microphone isn’t available right now. Close other apps using it and try again."
        case .interrupted:
            "Dictation stopped because another app took over the microphone."
        }
    }
}

private final class SpeechAnalyzerInputConverter: @unchecked Sendable {
    let sourceFormat: AVAudioFormat
    private let analyzerFormat: AVAudioFormat
    private let converter: AVAudioConverter?

    init(sourceFormat: AVAudioFormat, analyzerFormat: AVAudioFormat) throws {
        self.sourceFormat = sourceFormat
        self.analyzerFormat = analyzerFormat
        if sourceFormat == analyzerFormat {
            converter = nil
        } else {
            guard let converter = AVAudioConverter(from: sourceFormat, to: analyzerFormat) else {
                throw SpeechDictationError.audioConversionUnavailable
            }
            converter.primeMethod = .none
            self.converter = converter
        }
    }

    func convert(_ buffer: AVAudioPCMBuffer) throws -> [AnalyzerInput] {
        guard let converter else {
            // The tap hands back a buffer it reuses on the next callback, so it can
            // never be forwarded across the async boundary as-is.
            guard let copy = buffer.deepCopy() else { return [] }
            return [AnalyzerInput(buffer: copy)]
        }

        let ratio = analyzerFormat.sampleRate / sourceFormat.sampleRate
        // Leave headroom: sample-rate conversion can emit a frame more than the
        // ratio suggests, and an undersized buffer silently truncates audio.
        let frameCapacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * ratio)) + 64
        guard let output = AVAudioPCMBuffer(
            pcmFormat: analyzerFormat,
            frameCapacity: max(frameCapacity, 1)
        ) else {
            throw SpeechDictationError.audioConversionUnavailable
        }

        let inputState = SpeechAnalyzerInputSupplyState()
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
            if inputState.supplied {
                inputStatus.pointee = .noDataNow
                return nil
            }
            inputState.supplied = true
            inputStatus.pointee = .haveData
            return buffer
        }
        if let conversionError { throw conversionError }
        // `.inputRanDry` is the normal terminal status for a pull conversion that was
        // handed exactly one buffer. Treating it as failure threw away every frame.
        guard status != .error, output.frameLength > 0 else { return [] }
        return [AnalyzerInput(buffer: output)]
    }
}

private final class SpeechAnalyzerInputSupplyState: @unchecked Sendable {
    var supplied = false
}

private extension AVAudioPCMBuffer {
    func deepCopy() -> AVAudioPCMBuffer? {
        guard let copy = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameLength) else {
            return nil
        }
        copy.frameLength = frameLength
        let channels = Int(format.channelCount)
        if let source = floatChannelData, let destination = copy.floatChannelData {
            for channel in 0..<channels {
                destination[channel].update(from: source[channel], count: Int(frameLength) * stride)
            }
            return copy
        }
        if let source = int16ChannelData, let destination = copy.int16ChannelData {
            for channel in 0..<channels {
                destination[channel].update(from: source[channel], count: Int(frameLength) * stride)
            }
            return copy
        }
        if let source = int32ChannelData, let destination = copy.int32ChannelData {
            for channel in 0..<channels {
                destination[channel].update(from: source[channel], count: Int(frameLength) * stride)
            }
            return copy
        }
        return nil
    }
}
