import Observation
import AVFAudio
import Speech

@MainActor
@Observable
final class DictationModel: NSObject {
    private let recognizer = SFSpeechRecognizer()
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var sessionToken = UUID()

    var transcript = ""
    var isRecording = false
    var errorMessage: String?

    func clearTranscript() {
        transcript = ""
        errorMessage = nil
    }

    func requestAccess() async -> Bool {
        async let speechAccess = Self.requestSpeechAccess()
        async let microphoneAccess = AVAudioApplication.requestRecordPermission()
        let hasSpeechAccess = await speechAccess
        let hasMicrophoneAccess = await microphoneAccess
        return hasSpeechAccess && hasMicrophoneAccess
    }

    nonisolated private static func requestSpeechAccess() async -> Bool {
        await withCheckedContinuation(isolation: nil) { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    func start() async {
        guard !isRecording else { return }
        let token = UUID()
        sessionToken = token
        stop()
        clearTranscript()

        guard await requestAccess() else {
            errorMessage = "Speech recognition and microphone permission are required."
            return
        }
        guard let recognizer, recognizer.isAvailable else {
            errorMessage = "Speech recognition is not available right now."
            return
        }

        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            errorMessage = error.localizedDescription
            return
        }

        request = SFSpeechAudioBufferRecognitionRequest()
        guard let request else { return }
        request.shouldReportPartialResults = true

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            errorMessage = "Microphone input is not available."
            stop()
            return
        }
        input.removeTap(onBus: 0)
        Self.installAudioTap(on: input, format: format, request: request)

        recognitionTask = Self.makeRecognitionTask(
            recognizer: recognizer,
            request: request,
            owner: self,
            token: token
        )

        do {
            audioEngine.prepare()
            try audioEngine.start()
            isRecording = true
        } catch {
            errorMessage = error.localizedDescription
            stop()
        }
    }

    func stop() {
        sessionToken = UUID()
        guard isRecording || recognitionTask != nil else { return }
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        request = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated private static func installAudioTap(
        on input: AVAudioNode,
        format: AVAudioFormat,
        request: SFSpeechAudioBufferRecognitionRequest
    ) {
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
            request?.append(buffer)
        }
    }

    nonisolated private static func makeRecognitionTask(
        recognizer: SFSpeechRecognizer,
        request: SFSpeechAudioBufferRecognitionRequest,
        owner: DictationModel,
        token: UUID
    ) -> SFSpeechRecognitionTask {
        recognizer.recognitionTask(with: request) { [weak owner] result, error in
            let text = result?.bestTranscription.formattedString
            let shouldStop = error != nil || result?.isFinal == true
            Task { @MainActor in
                guard owner?.sessionToken == token else { return }
                if let text {
                    owner?.transcript = text
                }
                if shouldStop {
                    owner?.stop()
                }
            }
        }
    }
}
