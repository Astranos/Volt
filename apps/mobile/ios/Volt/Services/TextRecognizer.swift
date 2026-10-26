import CoreGraphics
import Foundation
#if canImport(UIKit)
import UIKit
#endif
@preconcurrency import Vision

enum TextRecognizer {
    private struct RecognizedGlyph {
        let character: Character
        let leadingWhitespace: String
        let boundingBox: CGRect
        let quadrilateral: TextQuadrilateral
    }

    #if canImport(UIKit)
    static func recognizeText(in image: UIImage) async throws -> String {
        try await recognizeTextRegions(in: image)
            .map(\.text)
            .joined(separator: "\n")
    }

    static func recognizeTextRegions(in image: UIImage, minimumTextHeight: Float = 0) async throws -> [RecognizedTextRegion] {
        guard let cgImage = image.cgImage else { return [] }
        return try await recognizeTextRegions(in: cgImage, minimumTextHeight: minimumTextHeight)
    }
    #endif

    static func recognizeTextRegions(in cgImage: CGImage, minimumTextHeight: Float = 0) async throws -> [RecognizedTextRegion] {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    continuation.resume(returning: try recognizeTextRegionsSynchronously(in: cgImage, minimumTextHeight: minimumTextHeight))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Vision already returns rotated quads for tilted lines, so a single upright pass is enough.
    /// Re-reading rotated copies drew 45° diamonds and could misread characters the upright pass got right.
    static func recognizeTextRegionsSynchronously(in cgImage: CGImage, minimumTextHeight: Float = 0) throws -> [RecognizedTextRegion] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.automaticallyDetectsLanguage = true
        request.minimumTextHeight = minimumTextHeight
        try VNImageRequestHandler(cgImage: cgImage, orientation: .up).perform([request])

        let aspectRatio = CGFloat(cgImage.width) / CGFloat(max(cgImage.height, 1))
        return (request.results ?? [])
            .flatMap { observation -> [RecognizedTextRegion] in
                guard let candidate = observation.topCandidates(1).first else { return [] }
                let glyphs = recognizedGlyphs(in: candidate.string, candidate: candidate)
                return splitRegions(for: candidate, glyphs: glyphs, fallbackObservation: observation, aspectRatio: aspectRatio)
            }
            .sorted(by: readingOrder)
    }

    private static func splitRegions(
        for candidate: VNRecognizedText,
        glyphs: [RecognizedGlyph],
        fallbackObservation: VNRecognizedTextObservation,
        aspectRatio: CGFloat
    ) -> [RecognizedTextRegion] {
        let text = candidate.string
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

        let readingAxis = CGPoint(
            x: (fallbackObservation.topRight.x - fallbackObservation.topLeft.x) * aspectRatio,
            y: fallbackObservation.topRight.y - fallbackObservation.topLeft.y
        )
        var regions: [RecognizedTextRegion] = []
        var currentText = ""
        var currentGlyphs: [RecognizedGlyph] = []
        var lastGlyph: RecognizedGlyph?

        for glyph in glyphs {
            if let lastGlyph, shouldStartNewRow(after: lastGlyph, before: glyph, readingAxis: readingAxis, aspectRatio: aspectRatio) {
                appendRegion(
                    text: currentText,
                    glyphs: currentGlyphs,
                    confidence: candidate.confidence,
                    aspectRatio: aspectRatio,
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
            aspectRatio: aspectRatio,
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

        return subdividingSharedWordBoxes(glyphs)
    }

    /// Vision often returns one rotated word box for every character range in that word. Splitting the
    /// box evenly along its reading edge gives each glyph its own rotated quad, so sub-word matches and
    /// reading direction follow the text instead of collapsing to an upright box.
    private static func subdividingSharedWordBoxes(_ glyphs: [RecognizedGlyph]) -> [RecognizedGlyph] {
        var result: [RecognizedGlyph] = []
        var start = 0
        while start < glyphs.count {
            var end = start + 1
            while end < glyphs.count, glyphs[end].quadrilateral == glyphs[start].quadrilateral {
                end += 1
            }
            let count = end - start
            let word = glyphs[start].quadrilateral
            for offset in 0..<count {
                let glyph = glyphs[start + offset]
                guard count > 1 else {
                    result.append(glyph)
                    continue
                }
                let lower = CGFloat(offset) / CGFloat(count)
                let upper = CGFloat(offset + 1) / CGFloat(count)
                let quadrilateral = TextQuadrilateral(
                    topLeft: interpolate(word.topLeft, word.topRight, lower),
                    topRight: interpolate(word.topLeft, word.topRight, upper),
                    bottomRight: interpolate(word.bottomLeft, word.bottomRight, upper),
                    bottomLeft: interpolate(word.bottomLeft, word.bottomRight, lower)
                )
                result.append(
                    RecognizedGlyph(
                        character: glyph.character,
                        leadingWhitespace: glyph.leadingWhitespace,
                        boundingBox: boundingRect(of: quadrilateral.points),
                        quadrilateral: quadrilateral
                    )
                )
            }
            start = end
        }
        return result
    }

    private static func interpolate(_ from: CGPoint, _ to: CGPoint, _ fraction: CGFloat) -> CGPoint {
        CGPoint(x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction)
    }

    private static func boundingRect(of points: [CGPoint]) -> CGRect {
        let xs = points.map(\.x)
        let ys = points.map(\.y)
        let minX = xs.min() ?? 0
        let minY = ys.min() ?? 0
        return CGRect(x: minX, y: minY, width: (xs.max() ?? 0) - minX, height: (ys.max() ?? 0) - minY)
    }

    /// Vision sometimes merges stacked label lines into one observation. A glyph starts a new row when it
    /// sits off the line's reading axis by most of a glyph height; measuring along the axis (in pixels)
    /// keeps tilted lines together instead of breaking them wherever their raw Y changes.
    private static func shouldStartNewRow(
        after previous: RecognizedGlyph,
        before next: RecognizedGlyph,
        readingAxis: CGPoint,
        aspectRatio: CGFloat
    ) -> Bool {
        let axisLength = hypot(readingAxis.x, readingAxis.y)
        guard axisLength > 0.0001 else { return false }

        func distanceFromAxis(_ vector: CGPoint) -> CGFloat {
            abs(vector.x * readingAxis.y - vector.y * readingAxis.x) / axisLength
        }
        let quad = previous.quadrilateral
        let glyphHeight = max(
            distanceFromAxis(CGPoint(x: (quad.topLeft.x - quad.bottomLeft.x) * aspectRatio, y: quad.topLeft.y - quad.bottomLeft.y)),
            0.006
        )
        let offset = distanceFromAxis(CGPoint(
            x: (next.boundingBox.midX - previous.boundingBox.midX) * aspectRatio,
            y: next.boundingBox.midY - previous.boundingBox.midY
        ))
        return offset > glyphHeight * 0.72
    }

    private static func appendRegion(
        text: String,
        glyphs: [RecognizedGlyph],
        confidence: Float,
        aspectRatio: CGFloat,
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
                    aspectRatio: aspectRatio,
                    isDeviceIdentifier: true,
                    to: &regions
                )
                return
            }
        }

        appendGlyphRegion(
            text: trimmed,
            glyphs: glyphs,
            confidence: confidence,
            aspectRatio: aspectRatio,
            to: &regions
        )
    }

    private static func appendGlyphRegion(
        text: String,
        glyphs: [RecognizedGlyph],
        confidence: Float,
        aspectRatio: CGFloat,
        isDeviceIdentifier: Bool = false,
        to regions: inout [RecognizedTextRegion]
    ) {
        guard let firstGlyph = glyphs.first else { return }
        let boundingBox = glyphs.dropFirst().reduce(firstGlyph.boundingBox) { partialResult, glyph in
            partialResult.union(glyph.boundingBox)
        }
        let quadrilateral = orientedQuadrilateral(enclosing: glyphs, aspectRatio: aspectRatio) ?? TextQuadrilateral(rect: boundingBox)
        regions.append(
            RecognizedTextRegion(
                text: text,
                boundingBox: boundingBox,
                quadrilateral: quadrilateral,
                confidence: confidence,
                isDeviceIdentifier: isDeviceIdentifier
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

    /// Smallest box aligned with the line's reading direction. Projection runs in pixel space
    /// (x scaled by the aspect ratio) so the box stays rectangular on non-square images.
    private static func orientedQuadrilateral(enclosing glyphs: [RecognizedGlyph], aspectRatio: CGFloat) -> TextQuadrilateral? {
        guard let firstGlyph = glyphs.first else { return nil }
        guard glyphs.count > 1 else { return firstGlyph.quadrilateral }

        let toPixels = { (point: CGPoint) in CGPoint(x: point.x * aspectRatio, y: point.y) }
        let fromPixels = { (point: CGPoint) in CGPoint(x: point.x / aspectRatio, y: point.y) }
        let points = glyphs.flatMap { $0.quadrilateral.points }.map(toPixels)
        guard let first = points.first else { return nil }

        let lastGlyph = glyphs[glyphs.count - 1]
        var direction = CGPoint(
            x: (lastGlyph.boundingBox.midX - firstGlyph.boundingBox.midX) * aspectRatio,
            y: lastGlyph.boundingBox.midY - firstGlyph.boundingBox.midY
        )
        if hypot(direction.x, direction.y) <= 0.0001 {
            let edge = firstGlyph.quadrilateral
            direction = CGPoint(x: (edge.topRight.x - edge.topLeft.x) * aspectRatio, y: edge.topRight.y - edge.topLeft.y)
        }
        let length = hypot(direction.x, direction.y)
        guard length > 0.0001 else {
            return axisAlignedQuadrilateral(enclosing: glyphs.flatMap { $0.quadrilateral.points })
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
            topLeft: fromPixels(point(axisX: axisX, x: minX, axisY: axisY, y: maxY)),
            topRight: fromPixels(point(axisX: axisX, x: maxX, axisY: axisY, y: maxY)),
            bottomRight: fromPixels(point(axisX: axisX, x: maxX, axisY: axisY, y: minY)),
            bottomLeft: fromPixels(point(axisX: axisX, x: minX, axisY: axisY, y: minY))
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

    private static func readingOrder(_ lhs: RecognizedTextRegion, _ rhs: RecognizedTextRegion) -> Bool {
        let sameRowThreshold = max(lhs.boundingBox.height, rhs.boundingBox.height) * 0.6
        if abs(lhs.boundingBox.midY - rhs.boundingBox.midY) <= sameRowThreshold {
            return lhs.boundingBox.minX < rhs.boundingBox.minX
        }
        return lhs.boundingBox.midY > rhs.boundingBox.midY
    }
}
