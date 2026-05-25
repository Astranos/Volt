import AVFoundation
import React
import Speech

@objc(VoltClipDictation)
class VoltClipDictation: RCTEventEmitter {
  private let audioEngine = AVAudioEngine()
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en_US"))
  private var hasListeners = false

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
      AVAudioSession.sharedInstance().requestRecordPermission { microphoneGranted in
        resolve([
          "granted": speechStatus == .authorized && microphoneGranted,
          "speechStatus": self.speechStatusName(speechStatus),
          "microphoneGranted": microphoneGranted,
        ])
      }
    }
  }

  @objc(start:rejecter:)
  func start(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    recognitionTask?.cancel()
    recognitionTask = nil

    guard let recognizer, recognizer.isAvailable else {
      reject("dictation_unavailable", "Speech recognition is unavailable.", nil)
      return
    }

    do {
      let audioSession = AVAudioSession.sharedInstance()
      try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
      try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

      let request = SFSpeechAudioBufferRecognitionRequest()
      request.shouldReportPartialResults = true
      recognitionRequest = request

      let inputNode = audioEngine.inputNode
      let format = inputNode.outputFormat(forBus: 0)
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
          if !transcript.isEmpty && self.hasListeners {
            self.sendEvent(withName: result.isFinal ? "final" : "partial", body: ["transcript": transcript])
          }
        }

        if let error {
          self.stopAudio()
          if self.hasListeners {
            self.sendEvent(withName: "error", body: ["message": error.localizedDescription])
          }
        }

        if result?.isFinal == true {
          self.stopAudio()
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
    recognitionRequest?.endAudio()
    stopAudio()
    resolve(["running": false])
  }

  private func stopAudio() {
    if audioEngine.isRunning {
      audioEngine.stop()
    }
    audioEngine.inputNode.removeTap(onBus: 0)
    recognitionRequest = nil
    recognitionTask = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
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
