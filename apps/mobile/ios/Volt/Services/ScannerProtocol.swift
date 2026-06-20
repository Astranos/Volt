import Foundation
import UIKit

enum ScannerProtocol {
    #if DEBUG
    static let signalURL = URL(string: "https://adorable-hornet-19.convex.site/api/signal")!
    #else
    static let signalURL = URL(string: "https://sincere-trout-414.convex.site/api/signal")!
    #endif
    static let controlChannelLabel = "scanner-control"
    static let photoTransferChannelLabel = "photo-transfer"
    static let protocolVersion = ProtocolVersion(major: 1, minor: 0, patch: 0)
    static let chunkSize = 64 * 1024
    static let joinAttemptTTL: Duration = .seconds(32)
    static let reconnectRequestTTL: Duration = .seconds(95)
    static let joinAttemptPollInterval: Duration = .milliseconds(650)
    static let iceGatheringTimeout: Duration = .seconds(2)

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

    static func baseMessage(type: String, prefix: String) -> [String: Any] {
        [
            "type": type,
            "messageId": makeMessageId(prefix),
            "sentAt": scannerDateString(from: .now),
        ]
    }

    @MainActor
    static func helloMessage(contributorId: String, chromeSessionId: String = "local") -> [String: Any] {
        var message = baseMessage(type: "hello", prefix: "hello")
        message["peer"] = [
            "protocolVersion": ["major": protocolVersion.major, "minor": protocolVersion.minor, "patch": protocolVersion.patch ?? 0],
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0",
            "platform": "ios",
            "capabilities": ["ocr", "barcode", "dictation", "photo", "photo_retry_queue"],
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
        var message = baseMessage(type: "capture_result", prefix: "capture")
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
        var message = baseMessage(type: "dictation", prefix: "dictation")
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
        var message = baseMessage(type: "photo_start", prefix: "photo")
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
        var message = baseMessage(type: "photo_chunk", prefix: "photo")
        message["photoId"] = photoId
        message["chunkIndex"] = index
        message["totalChunks"] = totalChunks
        message["data"] = data
        return message
    }

    static func photoComplete(photoId: String, totalChunks: Int) -> [String: Any] {
        var message = baseMessage(type: "photo_complete", prefix: "photo")
        message["photoId"] = photoId
        message["totalChunks"] = totalChunks
        return message
    }

    static func parseSessionReady(_ rawValue: String) -> SessionReady? {
        guard let data = rawValue.data(using: .utf8),
              let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              envelope["type"] as? String == "session_ready"
        else {
            return nil
        }
        return try? JSONDecoder().decode(SessionReady.self, from: data)
    }

    static func parseResultReceived(_ rawValue: String) -> ResultReceived? {
        guard let data = rawValue.data(using: .utf8),
              let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              envelope["type"] as? String == "result_received"
        else {
            return nil
        }
        return try? JSONDecoder().decode(ResultReceived.self, from: data)
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
