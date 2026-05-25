import AVFoundation
import AVFAudio
import React
import Speech

@objc(VoltClipDictation)
class VoltClipDictation: RCTEventEmitter {
  private var audioEngine: AVAudioEngine?
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private lazy var recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en_US"))
  private var hasListeners = false
  private var lastTranscript = ""
  private var finalTranscriptSent = false

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    ["partial", "final", "error"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  @objc(requestPermissions:rejecter:)
  func requestPermissions(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    SFSpeechRecognizer.requestAuthorization { speechStatus in
      self.requestMicrophonePermission { microphoneGranted in
        resolve(self.permissionPayload(speechStatus: speechStatus, microphoneGranted: microphoneGranted))
      }
    }
  }

  @objc(currentPermissions:rejecter:)
  func currentPermissions(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(permissionPayload(
      speechStatus: SFSpeechRecognizer.authorizationStatus(),
      microphoneGranted: currentMicrophonePermissionGranted()
    ))
  }

  @objc(start:resolver:rejecter:)
  func start(options: NSDictionary?, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    stopAudio()
    let addsPunctuation = options?["addsPunctuation"] as? Bool ?? true

    guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
      reject("dictation_not_authorized", "Speech recognition permission is not authorized.", nil)
      return
    }

    guard currentMicrophonePermissionGranted() else {
      reject("dictation_microphone_not_authorized", "Microphone permission is not authorized.", nil)
      return
    }

    guard let recognizer else {
      reject("dictation_unavailable", "Speech recognizer could not be created.", nil)
      return
    }

    do {
      let audioEngine = AVAudioEngine()
      self.audioEngine = audioEngine
      let audioSession = AVAudioSession.sharedInstance()
      try audioSession.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker, .allowBluetoothHFP])
      try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

      let request = SFSpeechAudioBufferRecognitionRequest()
      request.shouldReportPartialResults = true
      if #available(iOS 16.0, *) {
        request.addsPunctuation = addsPunctuation
      }
      if recognizer.supportsOnDeviceRecognition {
        request.requiresOnDeviceRecognition = true
      }
      recognitionRequest = request
      lastTranscript = ""
      finalTranscriptSent = false

      let inputNode = audioEngine.inputNode
      let format = inputNode.outputFormat(forBus: 0)
      guard format.sampleRate > 0 && format.channelCount > 0 else {
        stopAudio()
        reject("dictation_audio_unavailable", "Microphone input is unavailable.", nil)
        return
      }
      inputNode.removeTap(onBus: 0)
      inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
        self?.recognitionRequest?.append(buffer)
      }

      audioEngine.prepare()
      try audioEngine.start()

      recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
        guard let self else { return }

        if let result {
          let transcript = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
          self.lastTranscript = transcript
          if !transcript.isEmpty && self.hasListeners {
            if result.isFinal {
              self.emitFinalTranscript(transcript)
            } else {
              self.sendEvent(withName: "partial", body: ["transcript": transcript])
            }
          }
        }

        if let error {
          self.stopAudioInput()
          self.resetRecognitionState()
          if self.hasListeners {
            self.sendEvent(withName: "error", body: ["message": error.localizedDescription])
          }
        }

        if result?.isFinal == true {
          self.stopAudioInput()
          self.resetRecognitionState()
        }
      }

      resolve(["running": true])
    } catch {
      stopAudio()
      reject("dictation_start_failed", error.localizedDescription, error)
    }
  }

  @objc(stop:rejecter:)
  func stop(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let transcript = lastTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
    emitFinalTranscript(transcript)
    recognitionRequest?.endAudio()
    stopAudioInput()
    resetRecognitionState()
    resolve(["running": false])
  }

  private func stopAudio() {
    recognitionTask?.cancel()
    stopAudioInput()
    resetRecognitionState()
  }

  private func stopAudioInput() {
    guard let audioEngine else {
      return
    }

    if audioEngine.isRunning {
      audioEngine.stop()
    }
    audioEngine.inputNode.removeTap(onBus: 0)
    self.audioEngine = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func resetRecognitionState() {
    recognitionRequest = nil
    recognitionTask = nil
    lastTranscript = ""
  }

  private func emitFinalTranscript(_ transcript: String) {
    guard !finalTranscriptSent, !transcript.isEmpty, hasListeners else {
      return
    }

    finalTranscriptSent = true
    sendEvent(withName: "final", body: ["transcript": transcript])
  }

  private func permissionPayload(
    speechStatus: SFSpeechRecognizerAuthorizationStatus,
    microphoneGranted: Bool
  ) -> [String: Any] {
    [
      "granted": speechStatus == .authorized && microphoneGranted,
      "speechStatus": speechStatusName(speechStatus),
      "microphoneGranted": microphoneGranted,
    ]
  }

  private func currentMicrophonePermissionGranted() -> Bool {
    if #available(iOS 17.0, *) {
      return AVAudioApplication.shared.recordPermission == .granted
    }

    return AVAudioSession.sharedInstance().recordPermission == .granted
  }

  private func requestMicrophonePermission(completion: @escaping (Bool) -> Void) {
    let completeOnMain: (Bool) -> Void = { granted in
      DispatchQueue.main.async {
        completion(granted)
      }
    }

    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission { granted in
        completeOnMain(granted)
      }
      return
    }

    AVAudioSession.sharedInstance().requestRecordPermission { granted in
      completeOnMain(granted)
    }
  }

  private func speechStatusName(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch status {
    case .authorized:
      return "authorized"
    case .denied:
      return "denied"
    case .restricted:
      return "restricted"
    case .notDetermined:
      return "notDetermined"
    @unknown default:
      return "unknown"
    }
  }
}
