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
    static func reviewRegions(from regions: [RecognizedTextRegion]) -> [RecognizedTextRegion] {
        let identifierRegions = extractedIdentifierRegions(from: regions)
        var reviewRegions = deduplicated(identifierRegions)
        for region in regions {
            guard !containsEquivalentText(region, in: reviewRegions) else { continue }
            reviewRegions.append(region)
        }
        return reviewRegions.sorted(by: readingOrder)
    }

    static func extractedIdentifierRegions(from regions: [RecognizedTextRegion]) -> [RecognizedTextRegion] {
        let labeledIdentifierRegions = deduplicated(
            regions.filter(\.isDeviceIdentifier)
                + regions.compactMap { identifierRegion(from: $0, allowingStandalone: false) }
        )
        if !labeledIdentifierRegions.isEmpty {
            return labeledIdentifierRegions
        }

        let identifierRegions = regions.compactMap { identifierRegion(from: $0, allowingStandalone: true) }
        return identifierRegions.isEmpty ? regions : deduplicated(identifierRegions)
    }

    private static func identifierRegion(
        from region: RecognizedTextRegion,
        allowingStandalone: Bool
    ) -> RecognizedTextRegion? {
        guard let match = LiveTextIdentifierMatcher.match(region.text, allowingStandalone: allowingStandalone) else { return nil }
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

    private static func containsEquivalentText(_ region: RecognizedTextRegion, in regions: [RecognizedTextRegion]) -> Bool {
        regions.contains { existing in
            existing.text.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(
                region.text.trimmingCharacters(in: .whitespacesAndNewlines)
            ) == .orderedSame
        }
    }

    private static func readingOrder(_ lhs: RecognizedTextRegion, _ rhs: RecognizedTextRegion) -> Bool {
        let sameRowThreshold = max(lhs.boundingBox.height, rhs.boundingBox.height) * 0.6
        if abs(lhs.boundingBox.midY - rhs.boundingBox.midY) <= sameRowThreshold {
            return lhs.boundingBox.minX < rhs.boundingBox.minX
        }
        return lhs.boundingBox.midY > rhs.boundingBox.midY
    }
}

enum LiveTextCandidateKind: String, Equatable {
    case imei = "IMEI"
    case model = "Model"
    case serial = "Serial"
    case sku = "SKU"
}

struct LiveTextCandidate: Identifiable, Equatable {
    let id = UUID()
    let kind: LiveTextCandidateKind
    let value: String
    let bounds: CGRect
    let confidence: Float
}

struct LiveTextCandidateObservation: Equatable {
    let kind: LiveTextCandidateKind
    let value: String
    let boundingBox: CGRect
    let confidence: Float
}

struct LiveTextObservationSnapshot {
    let text: String
    let boundingBox: CGRect
    let confidence: Float
}

enum LiveTextCandidateObservationExtractor {
    static func prioritizedCandidates(
        directCandidates: [LiveTextCandidateObservation],
        snapshots: [LiveTextObservationSnapshot]
    ) -> [LiveTextCandidateObservation] {
        deduplicated(directCandidates + adjacentLabelValueCandidates(in: snapshots))
            .sorted { lhs, rhs in
                if lhs.kind.rawValue != rhs.kind.rawValue {
                    return lhs.kind.rawValue < rhs.kind.rawValue
                }
                return lhs.boundingBox.minY > rhs.boundingBox.minY
            }
            .prefix(4)
            .map { $0 }
    }

    private static func adjacentLabelValueCandidates(in snapshots: [LiveTextObservationSnapshot]) -> [LiveTextCandidateObservation] {
        let ordered = snapshots.sorted { lhs, rhs in
            if abs(lhs.boundingBox.midY - rhs.boundingBox.midY) > 0.025 {
                return lhs.boundingBox.midY > rhs.boundingBox.midY
            }
            return lhs.boundingBox.minX < rhs.boundingBox.minX
        }
        var candidates: [LiveTextCandidateObservation] = []

        for (index, label) in ordered.enumerated() {
            guard let kind = LiveTextIdentifierMatcher.labelKind(in: label.text) else { continue }
            for value in ordered[(index + 1)...].prefix(4) {
                guard isPlausibleValueObservation(value, near: label) else { continue }
                guard let candidateValue = LiveTextIdentifierMatcher.standaloneValue(in: value.text, kind: kind) else { continue }
                candidates.append(
                    LiveTextCandidateObservation(
                        kind: kind,
                        value: candidateValue,
                        boundingBox: value.boundingBox,
                        confidence: min(label.confidence, value.confidence)
                    )
                )
                break
            }
        }

        return candidates
    }

    private static func isPlausibleValueObservation(
        _ value: LiveTextObservationSnapshot,
        near label: LiveTextObservationSnapshot
    ) -> Bool {
        let verticalDistance = abs(label.boundingBox.midY - value.boundingBox.midY)
        let horizontalOverlap = min(label.boundingBox.maxX, value.boundingBox.maxX) - max(label.boundingBox.minX, value.boundingBox.minX)
        let sameRow = verticalDistance <= 0.035 && value.boundingBox.minX >= label.boundingBox.minX
        let nextRow = label.boundingBox.minY >= value.boundingBox.midY && label.boundingBox.minY - value.boundingBox.maxY <= 0.08
        return sameRow || nextRow || horizontalOverlap > -0.08
    }

    private static func deduplicated(_ candidates: [LiveTextCandidateObservation]) -> [LiveTextCandidateObservation] {
        var seen = Set<String>()
        return candidates.filter { candidate in
            let key = "\(candidate.kind.rawValue):\(candidate.value.uppercased())"
            guard !seen.contains(key) else { return false }
            seen.insert(key)
            return true
        }
    }
}

enum LiveTextIdentifierMatcher {
    struct Match {
        let kind: LiveTextCandidateKind
        let value: String
        let range: Range<String.Index>
    }

    static func match(_ rawText: String) -> Match? {
        match(rawText, allowingStandalone: true)
    }

    static func match(_ rawText: String, allowingStandalone: Bool) -> Match? {
        let text = rawText
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }

        if let imei = imei(in: text) {
            return imei
        }
        if let serial = labeledValue(in: text, labels: serialLabels) {
            return Match(kind: .serial, value: serial.value, range: serial.range)
        }
        if let model = labeledModelValue(in: text) {
            return Match(kind: .model, value: model.value, range: model.range)
        }
        if let sku = labeledValue(in: text, labels: skuLabels) {
            return Match(kind: .sku, value: sku.value, range: sku.range)
        }
        guard allowingStandalone else { return nil }
        if let standalone = standaloneIdentifier(in: text) {
            return standalone
        }
        return nil
    }

    static func labelKind(in rawText: String) -> LiveTextCandidateKind? {
        let text = rawText.lowercased()
        if text.contains("imei") || text.contains("meid") {
            return .imei
        }
        if containsLabel(in: text, labels: serialLabels) {
            return .serial
        }
        if containsLabel(in: text, labels: modelLabels) {
            return .model
        }
        if containsLabel(in: text, labels: skuLabels) {
            return .sku
        }
        return nil
    }

    static func standaloneValue(in rawText: String, kind: LiveTextCandidateKind) -> String? {
        switch kind {
        case .imei:
            return validLuhnCandidate(in: rawText)
        case .model:
            if let model = modelTokenCandidate(in: rawText) {
                return model.value
            }
            let cleaned = firstIdentifierToken(in: rawText)
            guard cleaned.count >= 4,
                  cleaned.rangeOfCharacter(from: .decimalDigits) != nil,
                  cleaned.rangeOfCharacter(from: .letters) != nil
            else { return nil }
            return isKnownModelToken(cleaned) ? normalizedModelToken(cleaned) : cleaned
        case .serial, .sku:
            let cleaned = firstIdentifierToken(in: rawText)
            guard cleaned.count >= 4,
                  cleaned.rangeOfCharacter(from: .decimalDigits) != nil,
                  cleaned.rangeOfCharacter(from: .letters) != nil
            else { return nil }
            return cleaned
        }
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

    private static func validLuhnCandidate(in text: String) -> String? {
        let digits = String(text.filter(\.isNumber))
        guard digits.count >= 15 else { return nil }

        for offset in 0...(digits.count - 15) {
            let start = digits.index(digits.startIndex, offsetBy: offset)
            let end = digits.index(start, offsetBy: 15)
            let candidate = String(digits[start..<end])
            if isValidLuhn(candidate) {
                return candidate
            }
        }
        return nil
    }

    private static let serialLabels = ["serial number", "serial no", "serial", "s/n", "s/ n", "s n", "s. n.", "sn"]
    private static let modelLabels = ["model number", "model no", "model", "mdl"]
    private static let skuLabels = ["sku", "stock keeping unit"]
    private static let regulatoryLabels = ["fcc id", "ic", "emc", "r-cmm", "can ices", "ices"]

    private static func labeledValue(in text: String, labels: [String]) -> (value: String, range: Range<String.Index>)? {
        let lowercased = text.lowercased()
        guard let labelRange = labels
            .compactMap({ labelRange(in: lowercased, label: $0) })
            .min(by: { $0.lowerBound < $1.lowerBound })
        else { return nil }

        let valueStart = text.index(text.startIndex, offsetBy: lowercased.distance(from: lowercased.startIndex, to: labelRange.upperBound))
        let suffix = String(text[valueStart...])
        let cleaned = firstIdentifierToken(in: suffix)
        guard cleaned.count >= 4, cleaned.rangeOfCharacter(from: .alphanumerics) != nil else { return nil }
        guard let valueRange = text[valueStart...].range(of: cleaned) else { return nil }
        return (cleaned, valueRange)
    }

    private static func labeledModelValue(in text: String) -> (value: String, range: Range<String.Index>)? {
        let lowercased = text.lowercased()
        guard let labelRange = modelLabels
            .compactMap({ labelRange(in: lowercased, label: $0) })
            .min(by: { $0.lowerBound < $1.lowerBound })
        else { return nil }

        let valueStart = text.index(text.startIndex, offsetBy: lowercased.distance(from: lowercased.startIndex, to: labelRange.upperBound))
        let suffix = String(text[valueStart...])
        if let model = modelTokenCandidate(in: suffix) {
            let lowerOffset = suffix.distance(from: suffix.startIndex, to: model.range.lowerBound)
            let upperOffset = suffix.distance(from: suffix.startIndex, to: model.range.upperBound)
            let lower = text.index(valueStart, offsetBy: lowerOffset)
            let upper = text.index(valueStart, offsetBy: upperOffset)
            return (model.value, lower..<upper)
        }

        return labeledValue(in: text, labels: modelLabels)
    }

    private static func standaloneIdentifier(in text: String) -> Match? {
        guard !isRegulatoryIdentifierContext(text) else { return nil }
        if let model = modelTokenCandidate(in: text) {
            return Match(kind: .model, value: model.value, range: model.range)
        }
        let candidates = identifierTokenCandidates(in: text)
        if let candidate = candidates.first(where: { isKnownModelToken($0.value) }) {
            return Match(kind: .model, value: normalizedModelToken(candidate.value), range: candidate.range)
        }
        if let candidate = candidates.first(where: { isLikelySerialToken($0.value) }) {
            return Match(kind: .serial, value: candidate.value, range: candidate.range)
        }
        return nil
    }

    private static func isRegulatoryIdentifierContext(_ text: String) -> Bool {
        containsLabel(in: text.lowercased(), labels: regulatoryLabels)
    }

    private static func containsLabel(in text: String, labels: [String]) -> Bool {
        labels.contains { labelRange(in: text, label: $0) != nil }
    }

    private static func labelRange(in text: String, label: String) -> Range<String.Index>? {
        var searchStart = text.startIndex
        while searchStart < text.endIndex,
              let range = text.range(of: label, range: searchStart..<text.endIndex) {
            if isLabelBoundary(in: text, before: range.lowerBound) && isLabelBoundary(in: text, after: range.upperBound) {
                return range
            }
            searchStart = range.upperBound
        }
        return nil
    }

    private static func isLabelBoundary(in text: String, before index: String.Index) -> Bool {
        guard index > text.startIndex else { return true }
        let previous = text[text.index(before: index)]
        return !previous.isLetter && !previous.isNumber
    }

    private static func isLabelBoundary(in text: String, after index: String.Index) -> Bool {
        guard index < text.endIndex else { return true }
        let next = text[index]
        return !next.isLetter && !next.isNumber
    }

    private static func firstIdentifierToken(in text: String) -> String {
        identifierTokenCandidates(in: text).first?.value ?? ""
    }

    private static func identifierTokenCandidates(in text: String) -> [(value: String, range: Range<String.Index>)] {
        text
            .split(whereSeparator: \.isWhitespace)
            .compactMap { rawToken -> (value: String, range: Range<String.Index>)? in
                let value = String(rawToken).trimmingCharacters(in: identifierTokenTrimCharacters)
                guard !value.isEmpty,
                      let range = text[rawToken.startIndex..<rawToken.endIndex].range(of: value)
                else { return nil }
                return (value, range)
            }
    }

    private static let identifierTokenTrimCharacters = CharacterSet(charactersIn: " #:=-{}[](),.;|")

    private static func modelTokenCandidate(in text: String) -> (value: String, range: Range<String.Index>)? {
        let candidates = identifierTokenCandidates(in: text)
        for (index, candidate) in candidates.enumerated() {
            let normalized = normalizedModelToken(candidate.value)
            if isKnownModelToken(normalized) {
                return (normalized, candidate.range)
            }

            guard index + 1 < candidates.count else { continue }
            let next = candidates[index + 1]
            if let combined = combinedModelToken(prefix: candidate.value, suffix: next.value) {
                return (combined, candidate.range.lowerBound..<next.range.upperBound)
            }
        }
        return nil
    }

    private static func combinedModelToken(prefix: String, suffix: String) -> String? {
        let normalizedPrefix = normalizedModelPrefix(prefix)
        let cleanedSuffix = suffix.trimmingCharacters(in: identifierTokenTrimCharacters).uppercased()
        guard let normalizedPrefix,
              cleanedSuffix.count >= 2,
              cleanedSuffix.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" })
        else { return nil }

        let combined = normalizedPrefix + cleanedSuffix
        return isKnownModelToken(combined) ? combined : nil
    }

    private static func isKnownModelToken(_ value: String) -> Bool {
        let uppercased = normalizedModelToken(value)
        guard uppercased.hasPrefix("CFI-"),
              uppercased.count >= 7,
              uppercased.count <= 20
        else { return false }
        return uppercased.allSatisfy { character in
            character.isLetter || character.isNumber || character == "-"
        }
    }

    private static func normalizedModelToken(_ value: String) -> String {
        let uppercased = value.uppercased()
        if uppercased.hasPrefix("CF1-") || uppercased.hasPrefix("CFL-") {
            return "CFI-" + String(uppercased.dropFirst(4))
        }
        if uppercased.hasPrefix("CF1") || uppercased.hasPrefix("CFL") {
            return "CFI-" + String(uppercased.dropFirst(3)).trimmingCharacters(in: identifierTokenTrimCharacters)
        }
        if uppercased.hasPrefix("CFI") && !uppercased.hasPrefix("CFI-") {
            let suffix = String(uppercased.dropFirst(3)).trimmingCharacters(in: identifierTokenTrimCharacters)
            if !suffix.isEmpty {
                return "CFI-" + suffix
            }
        }
        return uppercased
    }

    private static func normalizedModelPrefix(_ value: String) -> String? {
        let uppercased = value.uppercased().trimmingCharacters(in: identifierTokenTrimCharacters)
        if uppercased == "CFI" || uppercased == "CF1" || uppercased == "CFL" {
            return "CFI-"
        }
        return nil
    }

    private static func isLikelySerialToken(_ value: String) -> Bool {
        guard value.count >= 10, value.count <= 24 else { return false }
        let digitCount = value.filter(\.isNumber).count
        let letterCount = value.filter(\.isLetter).count
        guard digitCount >= 6, letterCount >= 1 else { return false }
        return value.allSatisfy { character in
            character.isLetter || character.isNumber || character == "-"
        }
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
