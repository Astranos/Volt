import CoreGraphics
import CoreImage
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

        var centerY: CGFloat {
            boundingBox.midY
        }
    }

    private struct LineAngle {
        let radians: CGFloat
        let weight: Int
    }

    private struct RecognitionPass {
        let regions: [RecognizedTextRegion]
        let lineAngles: [LineAngle]

        var hasDeviceIdentifier: Bool {
            regions.contains(where: \.isDeviceIdentifier)
        }

        var score: Int {
            regions.reduce(0) { total, region in
                let characters = region.text.filter { $0.isLetter || $0.isNumber }.count
                return total + characters + (region.isDeviceIdentifier ? 1000 : 0)
            }
        }
    }

    /// Text tilted further than this is re-read from a straightened copy of the image.
    private static let maximumUprightSkew: CGFloat = .pi / 15
    /// Vision reads roughly ±25° of tilt, so these cover steep diagonal labels it misses entirely.
    private static let fallbackRotations: [CGFloat] = [-.pi / 4, .pi / 4]

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

    /// Reads the image upright, then retries on a rotated copy when the text is tilted or no
    /// identifier was found. Regions from rotated passes are mapped back to the original image.
    static func recognizeTextRegionsSynchronously(in cgImage: CGImage, minimumTextHeight: Float = 0) throws -> [RecognizedTextRegion] {
        let upright = try recognitionPass(in: cgImage, rotation: 0, minimumTextHeight: minimumTextHeight)
        var rotations: [CGFloat] = []
        if let skew = dominantAngle(in: upright.lineAngles), abs(skew) > maximumUprightSkew {
            rotations.append(-skew)
        }
        if !upright.hasDeviceIdentifier {
            rotations += fallbackRotations.filter { rotation in
                rotations.allSatisfy { abs($0 - rotation) > maximumUprightSkew }
            }
        }

        var best = upright
        for rotation in rotations {
            if best.hasDeviceIdentifier, best.score > upright.score { break }
            let pass = try recognitionPass(in: cgImage, rotation: rotation, minimumTextHeight: minimumTextHeight)
            if pass.score > best.score {
                best = pass
            }
        }
        return best.regions.sorted(by: readingOrder)
    }

    private static func recognitionPass(in cgImage: CGImage, rotation: CGFloat, minimumTextHeight: Float) throws -> RecognitionPass {
        guard rotation != 0, let rotated = rotatedImage(cgImage, by: rotation) else {
            return try recognizedPass(in: cgImage, mapPoint: { $0 }, minimumTextHeight: minimumTextHeight)
        }
        return try recognizedPass(in: rotated.image, mapPoint: rotated.mapPoint, minimumTextHeight: minimumTextHeight)
    }

    private static func recognizedPass(
        in cgImage: CGImage,
        mapPoint: (CGPoint) -> CGPoint,
        minimumTextHeight: Float
    ) throws -> RecognitionPass {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.automaticallyDetectsLanguage = true
        request.minimumTextHeight = minimumTextHeight
        try VNImageRequestHandler(cgImage: cgImage, orientation: .up).perform([request])

        let aspectRatio = CGFloat(cgImage.width) / CGFloat(max(cgImage.height, 1))
        var regions: [RecognizedTextRegion] = []
        var lineAngles: [LineAngle] = []
        for observation in request.results ?? [] {
            guard let candidate = observation.topCandidates(1).first else { continue }
            let glyphs = recognizedGlyphs(in: candidate.string, candidate: candidate)
            if let angle = lineAngle(of: glyphs, aspectRatio: aspectRatio) {
                lineAngles.append(angle)
            }
            regions += splitRegions(for: candidate, glyphs: glyphs, fallbackObservation: observation, aspectRatio: aspectRatio)
        }
        return RecognitionPass(regions: regions.map { mapped($0, by: mapPoint) }, lineAngles: lineAngles)
    }

    private static func rotatedImage(_ cgImage: CGImage, by radians: CGFloat) -> (image: CGImage, mapPoint: (CGPoint) -> CGPoint)? {
        let size = CGSize(width: cgImage.width, height: cgImage.height)
        let transform = CGAffineTransform(translationX: size.width / 2, y: size.height / 2)
            .rotated(by: radians)
            .translatedBy(x: -size.width / 2, y: -size.height / 2)
        let rotated = CIImage(cgImage: cgImage).transformed(by: transform)
        let extent = rotated.extent.integral
        let background = CIImage(color: CIColor(red: 1, green: 1, blue: 1)).cropped(to: extent)
        guard let image = CIContext().createCGImage(rotated.composited(over: background), from: extent) else { return nil }

        let inverse = transform.inverted()
        return (image, { point in
            let original = CGPoint(
                x: extent.minX + point.x * extent.width,
                y: extent.minY + point.y * extent.height
            ).applying(inverse)
            return CGPoint(x: original.x / size.width, y: original.y / size.height)
        })
    }

    private static func mapped(_ region: RecognizedTextRegion, by mapPoint: (CGPoint) -> CGPoint) -> RecognizedTextRegion {
        let quadrilateral = TextQuadrilateral(
            topLeft: mapPoint(region.quadrilateral.topLeft),
            topRight: mapPoint(region.quadrilateral.topRight),
            bottomRight: mapPoint(region.quadrilateral.bottomRight),
            bottomLeft: mapPoint(region.quadrilateral.bottomLeft)
        )
        let xs = quadrilateral.points.map(\.x)
        let ys = quadrilateral.points.map(\.y)
        let boundingBox = CGRect(
            x: xs.min() ?? 0,
            y: ys.min() ?? 0,
            width: (xs.max() ?? 0) - (xs.min() ?? 0),
            height: (ys.max() ?? 0) - (ys.min() ?? 0)
        )
        return RecognizedTextRegion(
            text: region.text,
            boundingBox: boundingBox,
            quadrilateral: quadrilateral,
            confidence: region.confidence,
            isDeviceIdentifier: region.isDeviceIdentifier
        )
    }

    /// Reading direction of one recognized line, measured in pixels so non-square images don't skew it.
    private static func lineAngle(of glyphs: [RecognizedGlyph], aspectRatio: CGFloat) -> LineAngle? {
        guard glyphs.count >= 3, let first = glyphs.first, let last = glyphs.last else { return nil }
        let dx = (last.boundingBox.midX - first.boundingBox.midX) * aspectRatio
        let dy = last.boundingBox.midY - first.boundingBox.midY
        let glyphHeight = median(glyphs.map(\.boundingBox.height))
        guard hypot(dx, dy) > glyphHeight * 2 else { return nil }
        return LineAngle(radians: atan2(dy, dx), weight: glyphs.count)
    }

    private static func dominantAngle(in angles: [LineAngle]) -> CGFloat? {
        let sorted = angles.sorted { $0.radians < $1.radians }
        let totalWeight = sorted.reduce(0) { $0 + $1.weight }
        guard totalWeight > 0 else { return nil }
        var accumulated = 0
        for angle in sorted {
            accumulated += angle.weight
            if accumulated * 2 >= totalWeight {
                return angle.radians
            }
        }
        return nil
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
        let direction = CGPoint(
            x: (lastGlyph.boundingBox.midX - firstGlyph.boundingBox.midX) * aspectRatio,
            y: lastGlyph.boundingBox.midY - firstGlyph.boundingBox.midY
        )
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
