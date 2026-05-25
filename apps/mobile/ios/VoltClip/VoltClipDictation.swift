import AVFoundation
import React
import Speech

@objc(VoltClipDictation)
class VoltClipDictation: RCTEventEmitter {
  private var audioEngine: AVAudioEngine?
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private lazy var recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en_US"))
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
    stopAudio()

    guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
      reject("dictation_not_authorized", "Speech recognition permission is not authorized.", nil)
      return
    }

    guard AVAudioSession.sharedInstance().recordPermission == .granted else {
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
      if recognizer.supportsOnDeviceRecognition {
        request.requiresOnDeviceRecognition = true
      }
      recognitionRequest = request

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
          if !transcript.isEmpty && self.hasListeners {
            self.sendEvent(withName: result.isFinal ? "final" : "partial", body: ["transcript": transcript])
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
    recognitionRequest?.endAudio()
    stopAudioInput()
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
