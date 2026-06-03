import AVFoundation
import AVFAudio
import React

@objc(VoltClipDictation)
class VoltClipDictation: RCTEventEmitter {
  private var audioEngine: AVAudioEngine?
  private var hasListeners = false
  private var chunkSequence = 0

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    ["audioChunk", "error"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  @objc(requestPermissions:rejecter:)
  func requestPermissions(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    requestMicrophonePermission { microphoneGranted in
      resolve(self.permissionPayload(microphoneGranted: microphoneGranted))
    }
  }

  @objc(currentPermissions:rejecter:)
  func currentPermissions(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(permissionPayload(microphoneGranted: currentMicrophonePermissionGranted()))
  }

  @objc(start:resolver:rejecter:)
  func start(options: NSDictionary?, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    stopAudio()

    guard currentMicrophonePermissionGranted() else {
      reject("dictation_microphone_not_authorized", "Microphone permission is not authorized.", nil)
      return
    }

    do {
      let audioEngine = AVAudioEngine()
      self.audioEngine = audioEngine
      chunkSequence = 0

      let audioSession = AVAudioSession.sharedInstance()
      try audioSession.setCategory(.playAndRecord, mode: .measurement, options: [.mixWithOthers, .allowBluetoothA2DP])
      try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

      let inputNode = audioEngine.inputNode
      let format = inputNode.outputFormat(forBus: 0)
      guard format.sampleRate > 0 && format.channelCount > 0 else {
        stopAudio()
        reject("dictation_audio_unavailable", "Microphone input is unavailable.", nil)
        return
      }

      inputNode.removeTap(onBus: 0)
      inputNode.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
        self?.emitAudioChunk(buffer: buffer, format: format)
      }

      audioEngine.prepare()
      try audioEngine.start()
      resolve([
        "running": true,
        "format": "pcm_s16le",
        "sampleRate": 24000,
        "channels": 1,
      ])
    } catch {
      stopAudio()
      reject("dictation_start_failed", error.localizedDescription, error)
    }
  }

  @objc(stop:rejecter:)
  func stop(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    stopAudio()
    resolve(["running": false])
  }

  private func stopAudio() {
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

  private func emitAudioChunk(buffer: AVAudioPCMBuffer, format: AVAudioFormat) {
    guard hasListeners, let channelData = buffer.floatChannelData else {
      return
    }

    let frameCount = Int(buffer.frameLength)
    let channelCount = max(1, Int(format.channelCount))
    guard frameCount > 0 else {
      return
    }

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

    chunkSequence += 1
    sendEvent(
      withName: "audioChunk",
      body: [
        "chunk": data.base64EncodedString(),
        "format": "pcm_s16le",
        "sampleRate": outputSampleRate,
        "channels": 1,
        "sequence": chunkSequence,
      ]
    )
  }

  private func permissionPayload(microphoneGranted: Bool) -> [String: Any] {
    [
      "granted": microphoneGranted,
      "speechStatus": "external",
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
}
