import FoundationModels
import UIKit
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
            confidence: region.confidence
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

struct OcrTextCleanupResult: Equatable {
    let text: String
    let usedFoundationModel: Bool
}

enum OcrTextCleaner {
    static func clean(text: String) async -> OcrTextCleanupResult {
        let fallbackText = deterministicCleanup(text)
        guard shouldUseFoundationModel(for: fallbackText) else {
            return OcrTextCleanupResult(text: fallbackText, usedFoundationModel: false)
        }

        let model = SystemLanguageModel(
            useCase: .general,
            guardrails: .permissiveContentTransformations
        )
        guard case .available = model.availability else {
            return OcrTextCleanupResult(text: fallbackText, usedFoundationModel: false)
        }

        let session = LanguageModelSession(
            model: model,
            instructions: """
            You clean one selected OCR snippet for a mobile scanner.
            If it contains a serial number, model number, SKU, code, URL, email, phone number, or identifier with OCR artifacts before or after it, return only the intended value.
            Preserve exact casing, punctuation, separators, and digits unless an OCR error is obvious.
            Do not expand abbreviations. Do not explain. Do not add labels or surrounding quotes.
            """
        )
        let options = GenerationOptions(
            sampling: .greedy,
            temperature: 0,
            maximumResponseTokens: 80
        )

        do {
            let response = try await session.respond(
                to: """
                Clean this selected OCR text. Return only the cleaned text.

                \(fallbackText)
                """,
                options: options
            )
            return OcrTextCleanupResult(
                text: sanitizeModelOutput(response.content, fallback: fallbackText),
                usedFoundationModel: true
            )
        } catch {
            return OcrTextCleanupResult(text: fallbackText, usedFoundationModel: false)
        }
    }

    private static func shouldUseFoundationModel(for text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed.count <= 240
    }

    private static func deterministicCleanup(_ text: String) -> String {
        text
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func sanitizeModelOutput(_ output: String, fallback: String) -> String {
        var cleaned = output.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.hasPrefix("```") {
            cleaned = cleaned
                .replacingOccurrences(of: "```text", with: "")
                .replacingOccurrences(of: "```", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let lowercased = cleaned.lowercased()
        for prefix in ["cleaned:", "cleaned text:", "corrected:", "corrected text:"] where lowercased.hasPrefix(prefix) {
            cleaned = String(cleaned.dropFirst(prefix.count))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            break
        }
        if cleaned.hasPrefix("\""), cleaned.hasSuffix("\""), cleaned.count >= 2 {
            cleaned.removeFirst()
            cleaned.removeLast()
        }
        return cleaned.isEmpty ? fallback : cleaned
    }
}

enum TextRecognizer {
    private struct RecognizedGlyph {
        let character: Character
        let leadingWhitespace: String
        let boundingBox: CGRect
        let quadrilateral: TextQuadrilateral

        var centerY: CGFloat {
            boundingBox.midY
        }
    }

    static func recognizeText(in image: UIImage) async throws -> String {
        try await recognizeTextRegions(in: image)
            .map(\.text)
            .joined(separator: "\n")
    }

    static func recognizeTextRegions(in image: UIImage) async throws -> [RecognizedTextRegion] {
        guard let cgImage = image.cgImage else { return [] }

        return try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                let regions = (request.results as? [VNRecognizedTextObservation] ?? [])
                    .flatMap { observation -> [RecognizedTextRegion] in
                        guard let candidate = observation.topCandidates(1).first else { return [] }
                        return splitRegions(for: candidate, fallbackObservation: observation)
                    }
                    .sorted(by: readingOrder)

                continuation.resume(returning: regions)
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false
            request.automaticallyDetectsLanguage = true

            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try VNImageRequestHandler(cgImage: cgImage).perform([request])
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private static func splitRegions(for candidate: VNRecognizedText, fallbackObservation: VNRecognizedTextObservation) -> [RecognizedTextRegion] {
        let text = candidate.string
        let glyphs = recognizedGlyphs(in: text, candidate: candidate)
        guard !glyphs.isEmpty else {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return [] }
            return [
                RecognizedTextRegion(
                    text: trimmed,
                    boundingBox: fallbackObservation.boundingBox,
                    quadrilateral: TextQuadrilateral(observation: fallbackObservation),
                    confidence: candidate.confidence
                )
            ]
        }

        let rowBreakThreshold = max(median(glyphs.map { $0.boundingBox.height }) * 0.72, 0.006)
        var regions: [RecognizedTextRegion] = []
        var currentText = ""
        var currentGlyphs: [RecognizedGlyph] = []
        var lastGlyph: RecognizedGlyph?

        for glyph in glyphs {
            if let lastGlyph, shouldStartNewRow(after: lastGlyph, before: glyph, threshold: rowBreakThreshold) {
                appendRegion(
                    text: currentText,
                    glyphs: currentGlyphs,
                    confidence: candidate.confidence,
                    to: &regions
                )
                currentText = ""
                currentGlyphs = []
            }

            if !currentText.isEmpty {
                currentText += glyph.leadingWhitespace
            }
            currentText.append(glyph.character)
            currentGlyphs.append(glyph)
            lastGlyph = glyph
        }

        appendRegion(
            text: currentText,
            glyphs: currentGlyphs,
            confidence: candidate.confidence,
            to: &regions
        )

        if !regions.isEmpty {
            return regions
        }

        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        return [
            RecognizedTextRegion(
                text: trimmed,
                boundingBox: fallbackObservation.boundingBox,
                quadrilateral: TextQuadrilateral(observation: fallbackObservation),
                confidence: candidate.confidence
            )
        ]
    }

    private static func recognizedGlyphs(in text: String, candidate: VNRecognizedText) -> [RecognizedGlyph] {
        var glyphs: [RecognizedGlyph] = []
        var pendingWhitespace = ""
        var index = text.startIndex

        while index < text.endIndex {
            let nextIndex = text.index(after: index)
            let character = text[index]

            guard !character.isWhitespace else {
                pendingWhitespace.append(character)
                index = nextIndex
                continue
            }

            if let observation = try? candidate.boundingBox(for: index..<nextIndex) {
                glyphs.append(
                    RecognizedGlyph(
                        character: character,
                        leadingWhitespace: pendingWhitespace,
                        boundingBox: observation.boundingBox,
                        quadrilateral: TextQuadrilateral(observation: observation)
                    )
                )
                pendingWhitespace = ""
            }

            index = nextIndex
        }

        return glyphs
    }

    private static func shouldStartNewRow(after previous: RecognizedGlyph, before next: RecognizedGlyph, threshold: CGFloat) -> Bool {
        guard !previous.character.isWhitespace, !next.character.isWhitespace else { return false }

        let verticalDelta = abs(previous.centerY - next.centerY)
        guard verticalDelta > threshold else { return false }

        let overlap = previous.boundingBox.intersection(next.boundingBox).height
        let smallerHeight = max(min(previous.boundingBox.height, next.boundingBox.height), 0.0001)
        return overlap / smallerHeight < 0.35
    }

    private static func appendRegion(
        text: String,
        glyphs: [RecognizedGlyph],
        confidence: Float,
        to regions: inout [RecognizedTextRegion]
    ) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !glyphs.isEmpty else { return }

        if let match = LiveTextIdentifierMatcher.match(trimmed) {
            let matchedGlyphs = Self.glyphs(in: match.range, text: trimmed, glyphs: glyphs)
            if !matchedGlyphs.isEmpty {
                appendGlyphRegion(
                    text: match.value,
                    glyphs: matchedGlyphs,
                    confidence: confidence,
                    to: &regions
                )
                return
            }
        }

        appendGlyphRegion(
            text: trimmed,
            glyphs: glyphs,
            confidence: confidence,
            to: &regions
        )
    }

    private static func appendGlyphRegion(
        text: String,
        glyphs: [RecognizedGlyph],
        confidence: Float,
        to regions: inout [RecognizedTextRegion]
    ) {
        guard let firstGlyph = glyphs.first else { return }
        let boundingBox = glyphs.dropFirst().reduce(firstGlyph.boundingBox) { partialResult, glyph in
            partialResult.union(glyph.boundingBox)
        }
        let quadrilateral = orientedQuadrilateral(enclosing: glyphs) ?? TextQuadrilateral(rect: boundingBox)
        regions.append(
            RecognizedTextRegion(
                text: text,
                boundingBox: boundingBox,
                quadrilateral: quadrilateral,
                confidence: confidence
            )
        )
    }

    private static func glyphs(
        in range: Range<String.Index>,
        text: String,
        glyphs: [RecognizedGlyph]
    ) -> [RecognizedGlyph] {
        var matchedGlyphs: [RecognizedGlyph] = []
        var glyphIndex = 0
        var index = text.startIndex

        while index < text.endIndex, glyphIndex < glyphs.count {
            let character = text[index]
            if !character.isWhitespace {
                if range.contains(index) {
                    matchedGlyphs.append(glyphs[glyphIndex])
                }
                glyphIndex += 1
            }
            index = text.index(after: index)
        }

        return matchedGlyphs
    }

    private static func orientedQuadrilateral(enclosing glyphs: [RecognizedGlyph]) -> TextQuadrilateral? {
        guard let firstGlyph = glyphs.first else { return nil }
        guard glyphs.count > 1 else { return firstGlyph.quadrilateral }

        let points = glyphs.flatMap { $0.quadrilateral.points }
        guard let first = points.first else { return nil }

        let lastGlyph = glyphs[glyphs.count - 1]
        let direction = CGPoint(
            x: lastGlyph.boundingBox.midX - firstGlyph.boundingBox.midX,
            y: lastGlyph.boundingBox.midY - firstGlyph.boundingBox.midY
        )
        let length = hypot(direction.x, direction.y)
        guard length > 0.0001 else {
            return glyphs.dropFirst().reduce(firstGlyph.quadrilateral) { partialResult, glyph in
                axisAlignedQuadrilateral(enclosing: partialResult.points + glyph.quadrilateral.points)
            }
        }

        let axisX = CGPoint(x: direction.x / length, y: direction.y / length)
        let axisY = CGPoint(x: -axisX.y, y: axisX.x)

        var minX = dot(first, axisX)
        var maxX = minX
        var minY = dot(first, axisY)
        var maxY = minY

        for point in points.dropFirst() {
            let projectedX = dot(point, axisX)
            let projectedY = dot(point, axisY)
            minX = min(minX, projectedX)
            maxX = max(maxX, projectedX)
            minY = min(minY, projectedY)
            maxY = max(maxY, projectedY)
        }

        return TextQuadrilateral(
            topLeft: point(axisX: axisX, x: minX, axisY: axisY, y: maxY),
            topRight: point(axisX: axisX, x: maxX, axisY: axisY, y: maxY),
            bottomRight: point(axisX: axisX, x: maxX, axisY: axisY, y: minY),
            bottomLeft: point(axisX: axisX, x: minX, axisY: axisY, y: minY)
        )
    }

    private static func axisAlignedQuadrilateral(enclosing points: [CGPoint]) -> TextQuadrilateral {
        let minX = points.map(\.x).min() ?? 0
        let maxX = points.map(\.x).max() ?? 0
        let minY = points.map(\.y).min() ?? 0
        let maxY = points.map(\.y).max() ?? 0
        return TextQuadrilateral(
            topLeft: CGPoint(x: minX, y: maxY),
            topRight: CGPoint(x: maxX, y: maxY),
            bottomRight: CGPoint(x: maxX, y: minY),
            bottomLeft: CGPoint(x: minX, y: minY)
        )
    }

    private static func dot(_ point: CGPoint, _ axis: CGPoint) -> CGFloat {
        point.x * axis.x + point.y * axis.y
    }

    private static func point(axisX: CGPoint, x: CGFloat, axisY: CGPoint, y: CGFloat) -> CGPoint {
        CGPoint(x: axisX.x * x + axisY.x * y, y: axisX.y * x + axisY.y * y)
    }

    private static func median(_ values: [CGFloat]) -> CGFloat {
        let sorted = values.filter { $0 > 0 }.sorted()
        guard !sorted.isEmpty else { return 0 }
        let middle = sorted.count / 2
        if sorted.count.isMultiple(of: 2) {
            return (sorted[middle - 1] + sorted[middle]) / 2
        }
        return sorted[middle]
    }

    private static func readingOrder(_ lhs: RecognizedTextRegion, _ rhs: RecognizedTextRegion) -> Bool {
        let sameRowThreshold = max(lhs.boundingBox.height, rhs.boundingBox.height) * 0.6
        if abs(lhs.boundingBox.midY - rhs.boundingBox.midY) <= sameRowThreshold {
            return lhs.boundingBox.minX < rhs.boundingBox.minX
        }
        return lhs.boundingBox.midY > rhs.boundingBox.midY
    }
}
