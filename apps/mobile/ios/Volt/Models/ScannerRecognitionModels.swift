import CoreGraphics
import Foundation
@preconcurrency import Vision

struct TextQuadrilateral: Equatable {
    let topLeft: CGPoint
    let topRight: CGPoint
    let bottomRight: CGPoint
    let bottomLeft: CGPoint

    init(topLeft: CGPoint, topRight: CGPoint, bottomRight: CGPoint, bottomLeft: CGPoint) {
        self.topLeft = topLeft
        self.topRight = topRight
        self.bottomRight = bottomRight
        self.bottomLeft = bottomLeft
    }

    init(rect: CGRect) {
        self.init(
            topLeft: CGPoint(x: rect.minX, y: rect.maxY),
            topRight: CGPoint(x: rect.maxX, y: rect.maxY),
            bottomRight: CGPoint(x: rect.maxX, y: rect.minY),
            bottomLeft: CGPoint(x: rect.minX, y: rect.minY)
        )
    }

    init(observation: VNRectangleObservation) {
        self.init(
            topLeft: observation.topLeft,
            topRight: observation.topRight,
            bottomRight: observation.bottomRight,
            bottomLeft: observation.bottomLeft
        )
    }

    var points: [CGPoint] {
        [topLeft, topRight, bottomRight, bottomLeft]
    }
}

struct RecognizedTextRegion: Identifiable, Equatable {
    let id = UUID()
    let text: String
    let boundingBox: CGRect
    let quadrilateral: TextQuadrilateral
    let confidence: Float
    let isDeviceIdentifier: Bool

    init(
        text: String,
        boundingBox: CGRect,
        quadrilateral: TextQuadrilateral,
        confidence: Float,
        isDeviceIdentifier: Bool = false
    ) {
        self.text = text
        self.boundingBox = boundingBox
        self.quadrilateral = quadrilateral
        self.confidence = confidence
        self.isDeviceIdentifier = isDeviceIdentifier
    }
}

enum DeviceIdentifierRegionExtractor {
    static func extractedIdentifierRegions(from regions: [RecognizedTextRegion]) -> [RecognizedTextRegion] {
        let identifierRegions = regions.compactMap(identifierRegion(from:))
        return identifierRegions.isEmpty ? regions : deduplicated(identifierRegions)
    }

    private static func identifierRegion(from region: RecognizedTextRegion) -> RecognizedTextRegion? {
        guard let match = LiveTextIdentifierMatcher.match(region.text) else { return nil }
        return RecognizedTextRegion(
            text: match.value,
            boundingBox: region.boundingBox,
            quadrilateral: region.quadrilateral,
            confidence: region.confidence,
            isDeviceIdentifier: true
        )
    }

    private static func deduplicated(_ regions: [RecognizedTextRegion]) -> [RecognizedTextRegion] {
        var seen = Set<String>()
        return regions.filter { region in
            let key = region.text.uppercased()
            guard !seen.contains(key) else { return false }
            seen.insert(key)
            return true
        }
    }
}

enum LiveTextCandidateKind: String, Equatable {
    case imei = "IMEI"
    case model = "Model"
    case serial = "Serial"
}

struct LiveTextCandidate: Identifiable, Equatable {
    let id = UUID()
    let kind: LiveTextCandidateKind
    let value: String
    let bounds: CGRect
    let confidence: Float
}

enum LiveTextIdentifierMatcher {
    struct Match {
        let kind: LiveTextCandidateKind
        let value: String
        let range: Range<String.Index>
    }

    static func match(_ rawText: String) -> Match? {
        let text = rawText
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }

        if let imei = imei(in: text) {
            return imei
        }
        if let serial = labeledValue(in: text, labels: ["serial number", "serial no", "serial", "s/n", "sn"]) {
            return Match(kind: .serial, value: serial.value, range: serial.range)
        }
        if let model = labeledValue(in: text, labels: ["model number", "model no", "model", "mdl"]) {
            return Match(kind: .model, value: model.value, range: model.range)
        }
        return nil
    }

    private static func imei(in text: String) -> Match? {
        guard text.localizedCaseInsensitiveContains("imei") else { return nil }
        let digits = String(text.filter(\.isNumber))
        guard digits.count >= 15 else { return nil }

        for offset in 0...(digits.count - 15) {
            let start = digits.index(digits.startIndex, offsetBy: offset)
            let end = digits.index(start, offsetBy: 15)
            let candidate = String(digits[start..<end])
            guard isValidLuhn(candidate) else { continue }

            var digitIndex = 0
            var rangeStart: String.Index?
            var rangeEnd: String.Index?
            for index in text.indices where text[index].isNumber {
                if digitIndex == offset {
                    rangeStart = index
                }
                if digitIndex == offset + 14 {
                    rangeEnd = text.index(after: index)
                    break
                }
                digitIndex += 1
            }
            guard let rangeStart, let rangeEnd else { return nil }
            return Match(kind: .imei, value: candidate, range: rangeStart..<rangeEnd)
        }
        return nil
    }

    private static func labeledValue(in text: String, labels: [String]) -> (value: String, range: Range<String.Index>)? {
        let lowercased = text.lowercased()
        guard let labelRange = labels
            .compactMap({ lowercased.range(of: $0) })
            .min(by: { $0.lowerBound < $1.lowerBound })
        else { return nil }

        let valueStart = text.index(text.startIndex, offsetBy: lowercased.distance(from: lowercased.startIndex, to: labelRange.upperBound))
        let suffix = String(text[valueStart...])
        let trimmed = suffix
            .trimmingCharacters(in: CharacterSet(charactersIn: " #:=-\t\n\r"))
            .split(whereSeparator: \.isWhitespace)
            .first
            .map(String.init)
            ?? ""
        let cleaned = trimmed.trimmingCharacters(in: CharacterSet(charactersIn: ".,;:|"))
        guard cleaned.count >= 4, cleaned.rangeOfCharacter(from: .alphanumerics) != nil else { return nil }
        guard let valueRange = text[valueStart...].range(of: cleaned) else { return nil }
        return (cleaned, valueRange)
    }

    private static func isValidLuhn(_ value: String) -> Bool {
        let digits = value.compactMap(\.wholeNumberValue)
        guard digits.count == value.count else { return false }

        let checksum = digits.reversed().enumerated().reduce(0) { total, item in
            let (index, digit) = item
            guard index.isMultiple(of: 2) == false else { return total + digit }
            let doubled = digit * 2
            return total + (doubled > 9 ? doubled - 9 : doubled)
        }
        return checksum.isMultiple(of: 10)
    }
}
