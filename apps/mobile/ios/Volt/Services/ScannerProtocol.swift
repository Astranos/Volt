import Foundation
import UIKit

enum ScannerProtocol {
    static let developmentSignalURL = URL(string: "https://adorable-hornet-19.convex.site/api/signal")!
    static let productionSignalURL = URL(string: "https://sincere-trout-414.convex.site/api/signal")!
    #if DEBUG
    static let signalURL = developmentSignalURL
    static let fallbackSignalURLs = [productionSignalURL]
    #else
    static let signalURL = productionSignalURL
    static let fallbackSignalURLs: [URL] = []
    #endif
    static let reconnectSignalURLs = [signalURL] + fallbackSignalURLs
    static let controlChannelLabel = "scanner-control"
    static let photoTransferChannelLabel = "photo-transfer"
    static let protocolVersion = ProtocolVersion(major: 1, minor: 0, patch: 0)
    static let chunkSize = 64 * 1024
    static let joinAttemptTTL: Duration = .seconds(32)
    static let reconnectRequestTTL: Duration = .seconds(95)
    static let joinAttemptPollInterval: Duration = .milliseconds(650)
    static let iceGatheringTimeout: Duration = .seconds(2)
    static let photoReceiptTimeout: Duration = .seconds(20)
    static let signalRequestTimeout: TimeInterval = 8
    static let supportedCapabilities = ["ocr", "barcode", "dictation", "photo", "photo_retry_queue"]
    static let supportedPeerPlatforms = ["ios", "chrome_extension", "web", "unknown"]

    enum MessageType: String, CaseIterable {
        case hello
        case captureResult = "capture_result"
        case dictation
        case modeChanged = "mode_changed"
        case sessionReady = "session_ready"
        case resultReceived = "result_received"
        case protocolError = "protocol_error"
        case photoStart = "photo_start"
        case photoChunk = "photo_chunk"
        case photoComplete = "photo_complete"
        case photoChunkAck = "photo_chunk_ack"
        case photoReceived = "photo_received"
        case photoRejected = "photo_rejected"
        case photoCancel = "photo_cancel"
        case sessionClosed = "session_closed"
    }

    static let controlMessageTypes: [String] = [
        MessageType.hello.rawValue,
        MessageType.sessionReady.rawValue,
        MessageType.modeChanged.rawValue,
        MessageType.captureResult.rawValue,
        MessageType.dictation.rawValue,
        MessageType.resultReceived.rawValue,
        MessageType.photoChunkAck.rawValue,
        MessageType.photoReceived.rawValue,
        MessageType.photoRejected.rawValue,
        MessageType.protocolError.rawValue,
        MessageType.sessionClosed.rawValue,
    ]

    static let photoTransferMessageTypes: [String] = [
        MessageType.photoStart.rawValue,
        MessageType.photoChunk.rawValue,
        MessageType.photoComplete.rawValue,
        MessageType.photoCancel.rawValue,
    ]

    static var captureModeValues: [String] {
        CaptureMode.allCases.map(\.rawValue)
    }

    struct ProtocolVersion: Codable, Equatable {
        let major: Int
        let minor: Int
        let patch: Int?
    }

    struct Peer: Codable, Equatable {
        let protocolVersion: ProtocolVersion
        let appVersion: String?
        let platform: String
        let capabilities: [String]
        let contributorId: String?
        let deviceLabel: String?
        let chromeSessionId: String
    }

    struct SessionDescription: Codable, Equatable {
        let type: String
        let sdp: String
    }

    struct IceServerConfiguration: Codable, Equatable {
        let iceServers: [IceServer]
        let ttlSeconds: Int?
        let expiresAt: String?

        init(iceServers: [IceServer], ttlSeconds: Int? = nil, expiresAt: String? = nil) {
            self.iceServers = iceServers
            self.ttlSeconds = ttlSeconds
            self.expiresAt = expiresAt
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            iceServers = try container.decode([IceServer].self, forKey: .iceServers)
            ttlSeconds = try container.decodeIfPresent(Int.self, forKey: .ttlSeconds)
            expiresAt = try container.decodeIfPresent(String.self, forKey: .expiresAt)

            if iceServers.isEmpty {
                throw DecodingError.dataCorruptedError(
                    forKey: .iceServers,
                    in: container,
                    debugDescription: "ICE server configuration must include at least one server."
                )
            }
        }
    }

    struct IceServer: Codable, Equatable {
        let urls: [String]
        let username: String?
        let credential: String?

        init(urls: [String], username: String? = nil, credential: String? = nil) {
            self.urls = urls
            self.username = username
            self.credential = credential
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            if let urlList = try? container.decode([String].self, forKey: .urls) {
                urls = urlList
            } else {
                urls = [try container.decode(String.self, forKey: .urls)]
            }
            username = try container.decodeIfPresent(String.self, forKey: .username)
            credential = try container.decodeIfPresent(String.self, forKey: .credential)

            if urls.isEmpty || urls.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
                throw DecodingError.dataCorruptedError(
                    forKey: .urls,
                    in: container,
                    debugDescription: "ICE server URLs must be non-empty."
                )
            }
        }
    }

    struct JoinAttempt: Codable, Equatable {
        let attemptId: String
        let pollURL: URL
        let answerURL: URL
        let sessionId: String?
    }

    struct SessionReady: Decodable, Equatable {
        struct Peer: Decodable, Equatable {
            let chromeSessionId: String?
            let deviceLabel: String?
            let platform: String?
        }

        struct Pairing: Decodable, Equatable {
            let pairingId: String
            let pairingSecret: String
            let browserSessionId: String
            let displayName: String?
        }

        struct CursorTarget: Decodable, Equatable {
            let tabTitle: String?
            let url: String?
            let label: String?
            let hasCursorTarget: Bool?
        }

        let peer: Peer?
        let activeMode: CaptureMode?
        let pairing: Pairing?
        let cursorTarget: CursorTarget?
    }

    struct ResultReceived: Decodable, Equatable {
        let resultId: String
        let savedToResults: Bool
        let insertedIntoCursor: Bool?
        let cursorTarget: SessionReady.CursorTarget?
    }

    struct PhotoChunkAck: Decodable, Equatable {
        let photoId: String
        let chunkIndex: Int
        let totalChunks: Int
    }

    struct PhotoReceived: Decodable, Equatable {
        let photoId: String
        let photoBatchId: String
        let storedAt: String
        let size: Int
    }

    struct PhotoRejected: Decodable, Equatable {
        let photoId: String
        let reason: String
        let retryable: Bool
        let detail: String?
    }

    struct ProtocolError: Decodable, Equatable {
        let code: String
        let detail: String?
        let receivedType: String?
    }

    struct DictationTranscript: Decodable, Equatable {
        let dictationSessionId: String
        let phase: String
        let text: String?
        let insertIntoCursor: Bool?
    }

    enum PhotoDeliveryReceipt: Equatable {
        case received(PhotoReceived)
        case rejected(PhotoRejected)
    }

    struct PhotoPayload {
        let id: String
        let batchId: String
        let filename: String
        let data: Data
        let width: Int
        let height: Int
        let capturedAt: Date
    }

    static func makeContributorId() -> String {
        "volt-photo-\(UUID().uuidString.replacing("-", with: "").lowercased().prefix(24))"
    }

    static func makeMessageId(_ prefix: String) -> String {
        "\(prefix)-\(Int(Date.now.timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8).lowercased())"
    }

    static var fallbackIceServerConfiguration: IceServerConfiguration {
        IceServerConfiguration(iceServers: [
            IceServer(urls: ["stun:stun.l.google.com:19302"]),
            IceServer(urls: ["stun:stun1.l.google.com:19302"]),
        ])
    }

    static func encodePairingPayload(_ payload: SessionDescription) throws -> String {
        let data = try JSONEncoder.scanner.encode(payload)
        return data.base64EncodedString()
            .replacing("+", with: "-")
            .replacing("/", with: "_")
            .replacing("=", with: "")
    }

    static func decodePairingPayload(_ payload: String) throws -> SessionDescription {
        var base64 = payload.replacing("-", with: "+").replacing("_", with: "/")
        let padding = (4 - base64.count % 4) % 4
        if padding > 0 {
            base64 += String(repeating: "=", count: padding)
        }
        guard let data = Data(base64Encoded: base64) else {
            throw ScannerPairingError.invalidPairingPayload
        }
        return try JSONDecoder().decode(SessionDescription.self, from: data)
    }

    static func encodedControlMessage(_ message: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: message)
        guard let value = String(data: data, encoding: .utf8) else {
            throw ScannerPairingError.invalidMessage
        }
        return value
    }

    static func baseMessage(type: MessageType, prefix: String) -> [String: Any] {
        [
            "type": type.rawValue,
            "messageId": makeMessageId(prefix),
            "sentAt": scannerDateString(from: .now),
        ]
    }

    @MainActor
    static func helloMessage(contributorId: String, chromeSessionId: String = "local") -> [String: Any] {
        var message = baseMessage(type: .hello, prefix: "hello")
        message["peer"] = [
            "protocolVersion": ["major": protocolVersion.major, "minor": protocolVersion.minor, "patch": protocolVersion.patch ?? 0],
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.1",
            "platform": "ios",
            "capabilities": supportedCapabilities,
            "contributorId": contributorId,
            "deviceLabel": UIDevice.current.name,
            "chromeSessionId": chromeSessionId,
        ]
        return message
    }

    static func captureResult(
        id: String,
        kind: String,
        value: String,
        format: String,
        capturedAt: Date,
        insertIntoCursor: Bool,
        contributorId: String
    ) -> [String: Any] {
        var message = baseMessage(type: .captureResult, prefix: "capture")
        message["resultId"] = id
        message["resultKind"] = kind
        message["value"] = value
        message["format"] = format
        message["capturedAt"] = scannerDateString(from: capturedAt)
        message["insertIntoCursor"] = insertIntoCursor
        message["contributorId"] = contributorId
        return message
    }

    static func dictationMessage(sessionId: String, phase: String, text: String?, insertIntoCursor: Bool) -> [String: Any] {
        var message = baseMessage(type: .dictation, prefix: "dictation")
        message["dictationSessionId"] = sessionId
        message["phase"] = phase
        message["capturedAt"] = scannerDateString(from: .now)
        message["insertIntoCursor"] = insertIntoCursor
        if let text {
            message["text"] = text
        }
        return message
    }

    static func photoStart(_ payload: PhotoPayload, contributorId: String, totalChunks: Int) -> [String: Any] {
        var message = baseMessage(type: .photoStart, prefix: "photo")
        message["photoId"] = payload.id
        message["photoBatchId"] = payload.batchId
        message["contributorId"] = contributorId
        message["filename"] = payload.filename
        message["mimeType"] = "image/jpeg"
        message["size"] = payload.data.count
        message["width"] = payload.width
        message["height"] = payload.height
        message["capturedAt"] = scannerDateString(from: payload.capturedAt)
        message["chunkSize"] = chunkSize
        message["totalChunks"] = totalChunks
        return message
    }

    static func photoChunk(photoId: String, index: Int, totalChunks: Int, data: String) -> [String: Any] {
        var message = baseMessage(type: .photoChunk, prefix: "photo")
        message["photoId"] = photoId
        message["chunkIndex"] = index
        message["totalChunks"] = totalChunks
        message["data"] = data
        return message
    }

    static func photoComplete(photoId: String, totalChunks: Int) -> [String: Any] {
        var message = baseMessage(type: .photoComplete, prefix: "photo")
        message["photoId"] = photoId
        message["totalChunks"] = totalChunks
        return message
    }

    static func parseSessionReady(_ rawValue: String) -> SessionReady? {
        guard let data = data(for: rawValue, matching: .sessionReady) else { return nil }
        return try? JSONDecoder().decode(SessionReady.self, from: data)
    }

    static func parseResultReceived(_ rawValue: String) -> ResultReceived? {
        guard let data = data(for: rawValue, matching: .resultReceived) else { return nil }
        return try? JSONDecoder().decode(ResultReceived.self, from: data)
    }

    static func parseProtocolError(_ rawValue: String) -> ProtocolError? {
        guard let data = data(for: rawValue, matching: .protocolError) else { return nil }
        return try? JSONDecoder().decode(ProtocolError.self, from: data)
    }

    static func parseDictationTranscript(_ rawValue: String) -> DictationTranscript? {
        guard let data = data(for: rawValue, matching: .dictation),
              let transcript = try? JSONDecoder().decode(DictationTranscript.self, from: data),
              (transcript.phase == "partial" || transcript.phase == "final")
        else { return nil }
        return transcript
    }

    static func parsePhotoChunkAck(_ rawValue: String) -> PhotoChunkAck? {
        guard let data = data(for: rawValue, matching: .photoChunkAck) else { return nil }
        return try? JSONDecoder().decode(PhotoChunkAck.self, from: data)
    }

    static func parsePhotoReceived(_ rawValue: String) -> PhotoReceived? {
        guard let data = data(for: rawValue, matching: .photoReceived) else { return nil }
        return try? JSONDecoder().decode(PhotoReceived.self, from: data)
    }

    static func parsePhotoRejected(_ rawValue: String) -> PhotoRejected? {
        guard let data = data(for: rawValue, matching: .photoRejected) else { return nil }
        return try? JSONDecoder().decode(PhotoRejected.self, from: data)
    }

    private static func data(for rawValue: String, matching type: MessageType) -> Data? {
        guard let data = rawValue.data(using: .utf8),
              let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              envelope["type"] as? String == type.rawValue
        else {
            return nil
        }
        return data
    }

    private static func scannerDateString(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

enum ScannerPairingError: LocalizedError {
    case invalidPairingPayload
    case invalidMessage
    case missingPairingURL
    case missingOffer
    case missingAnswer
    case couldNotCreatePeer
    case channelNotOpen
    case chromeTimedOut
    case joinTokenExpired
    case requestFailed
    case signalRejected(statusCode: Int, detail: String?)
    case photoRejected(String)
    case photoDeliveryInterrupted
    case photoDeliveryTimedOut

    var errorDescription: String? {
        switch self {
        case .invalidPairingPayload: "The pairing QR is not valid."
        case .invalidMessage: "Could not encode scanner protocol message."
        case .missingPairingURL: "Scan the Chrome pairing QR again."
        case .missingOffer: "Chrome did not publish a WebRTC offer."
        case .missingAnswer: "Could not create a WebRTC answer."
        case .couldNotCreatePeer: "Could not create a WebRTC connection."
        case .channelNotOpen: "Pair with Chrome before sending."
        case .chromeTimedOut: "Chrome did not respond in time. Reopen the QR and scan again."
        case .joinTokenExpired: "This Chrome pairing session expired. Scan the QR again."
        case .requestFailed: "The scanner signaling service did not accept the request."
        case .signalRejected(let statusCode, let detail):
            if let detail, !detail.isEmpty {
                "The scanner signaling service rejected the request (\(statusCode)): \(detail)"
            } else {
                "The scanner signaling service rejected the request (\(statusCode))."
            }
        case .photoRejected(let reason): "Chrome rejected the photo: \(reason)"
        case .photoDeliveryInterrupted: "Photo delivery was interrupted."
        case .photoDeliveryTimedOut: "Chrome did not confirm photo delivery in time."
        }
    }
}

extension JSONEncoder {
    static var scanner: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
