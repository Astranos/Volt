import UIKit
@preconcurrency import Vision

struct RecognizedTextRegion: Identifiable, Equatable {
    let id = UUID()
    let text: String
    let boundingBox: CGRect
    let confidence: Float
}

enum TextRecognizer {
    private struct RecognizedGlyph {
        let character: Character
        let leadingWhitespace: String
        let boundingBox: CGRect

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
                        return splitRegions(for: candidate, fallbackBoundingBox: observation.boundingBox)
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

    private static func splitRegions(for candidate: VNRecognizedText, fallbackBoundingBox: CGRect) -> [RecognizedTextRegion] {
        let text = candidate.string
        let glyphs = recognizedGlyphs(in: text, candidate: candidate)
        guard !glyphs.isEmpty else {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return [] }
            return [
                RecognizedTextRegion(
                    text: trimmed,
                    boundingBox: fallbackBoundingBox,
                    confidence: candidate.confidence
                )
            ]
        }

        let rowBreakThreshold = max(median(glyphs.map { $0.boundingBox.height }) * 0.72, 0.006)
        var regions: [RecognizedTextRegion] = []
        var currentText = ""
        var currentBoxes: [CGRect] = []
        var lastGlyph: RecognizedGlyph?

        for glyph in glyphs {
            if let lastGlyph, shouldStartNewRow(after: lastGlyph, before: glyph, threshold: rowBreakThreshold) {
                appendRegion(
                    text: currentText,
                    boxes: currentBoxes,
                    confidence: candidate.confidence,
                    to: &regions
                )
                currentText = ""
                currentBoxes = []
            }

            if !currentText.isEmpty {
                currentText += glyph.leadingWhitespace
            }
            currentText.append(glyph.character)
            currentBoxes.append(glyph.boundingBox)
            lastGlyph = glyph
        }

        appendRegion(
            text: currentText,
            boxes: currentBoxes,
            confidence: candidate.confidence,
            to: &regions
        )

        if !regions.isEmpty {
            return regions
        }

        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        return [RecognizedTextRegion(text: trimmed, boundingBox: fallbackBoundingBox, confidence: candidate.confidence)]
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

            if let boundingBox = try? candidate.boundingBox(for: index..<nextIndex)?.boundingBox {
                glyphs.append(RecognizedGlyph(character: character, leadingWhitespace: pendingWhitespace, boundingBox: boundingBox))
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
        boxes: [CGRect],
        confidence: Float,
        to regions: inout [RecognizedTextRegion]
    ) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let firstBox = boxes.first else { return }

        let boundingBox = boxes.dropFirst().reduce(firstBox) { partialResult, box in
            partialResult.union(box)
        }
        regions.append(RecognizedTextRegion(text: trimmed, boundingBox: boundingBox, confidence: confidence))
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
