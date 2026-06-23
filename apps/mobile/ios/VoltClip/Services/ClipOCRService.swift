import CoreGraphics
import Foundation
import UIKit
@preconcurrency import Vision

struct ClipOCRResult: Equatable {
    let text: String
    let regions: [RecognizedTextRegion]
    let capturedAt: Date
    let observationCount: Int

    var isEmpty: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct ClipOCRService {
    func recognizeText(in image: UIImage) async throws -> ClipOCRResult {
        guard let cgImage = image.normalizedForClipOCR().cgImage else {
            throw ClipOCRError.imageUnavailable
        }

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.automaticallyDetectsLanguage = true
        request.minimumTextHeight = 0.018

        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up)
        try handler.perform([request])

        let recognizedRegions = (request.results ?? [])
            .compactMap(region)
            .sorted(by: readingOrder)
        let regions = DeviceIdentifierRegionExtractor.extractedIdentifierRegions(from: recognizedRegions)
        let lines = regions.map(\.text)

        return ClipOCRResult(
            text: lines.joined(separator: "\n"),
            regions: regions,
            capturedAt: .now,
            observationCount: lines.count
        )
    }

    private func region(from observation: VNRecognizedTextObservation) -> RecognizedTextRegion? {
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return RecognizedTextRegion(
            text: text,
            boundingBox: observation.boundingBox,
            quadrilateral: TextQuadrilateral(observation: observation),
            confidence: candidate.confidence
        )
    }

    private func readingOrder(_ lhs: RecognizedTextRegion, _ rhs: RecognizedTextRegion) -> Bool {
        let sameRowThreshold = max(lhs.boundingBox.height, rhs.boundingBox.height) * 0.6
        if abs(lhs.boundingBox.midY - rhs.boundingBox.midY) <= sameRowThreshold {
            return lhs.boundingBox.minX < rhs.boundingBox.minX
        }
        return lhs.boundingBox.midY > rhs.boundingBox.midY
    }
}

enum ClipOCRError: LocalizedError {
    case imageUnavailable

    var errorDescription: String? {
        switch self {
        case .imageUnavailable:
            "Could not prepare the image for text recognition."
        }
    }
}

private extension UIImage {
    func normalizedForClipOCR(maxLongEdge: CGFloat = 1800) -> UIImage {
        let normalized: UIImage
        if imageOrientation == .up {
            normalized = self
        } else {
            let format = UIGraphicsImageRendererFormat()
            format.scale = scale
            let renderer = UIGraphicsImageRenderer(size: size, format: format)
            normalized = renderer.image { _ in
                draw(in: CGRect(origin: .zero, size: size))
            }
        }

        let longEdge = max(normalized.size.width, normalized.size.height)
        guard longEdge > maxLongEdge, longEdge > 0 else { return normalized }

        let ratio = maxLongEdge / longEdge
        let targetSize = CGSize(
            width: max(1, normalized.size.width * ratio),
            height: max(1, normalized.size.height * ratio)
        )
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
        return renderer.image { _ in
            normalized.draw(in: CGRect(origin: .zero, size: targetSize))
        }
    }
}
