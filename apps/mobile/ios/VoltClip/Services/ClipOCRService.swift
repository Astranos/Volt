import CoreGraphics
import CoreImage
import Foundation
import UIKit

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
        let preparedImage = image
            .normalizedForClipOCR()
            .cleanedForClipOCR()
            .resizedForClipOCR(maxLongEdge: 1800)
        guard let cgImage = preparedImage.cgImage else {
            throw ClipOCRError.imageUnavailable
        }

        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    continuation.resume(returning: try recognizePreparedText(in: cgImage))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func recognizePreparedText(in cgImage: CGImage) throws -> ClipOCRResult {
        let recognizedRegions = try TextRecognizer.recognizeTextRegionsSynchronously(in: cgImage, minimumTextHeight: 0.018)
        let regions = DeviceIdentifierRegionExtractor.reviewRegions(from: recognizedRegions)
        let lines = regions.map(\.text)

        return ClipOCRResult(
            text: lines.joined(separator: "\n"),
            regions: regions,
            capturedAt: .now,
            observationCount: lines.count
        )
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

    func cleanedForClipOCR() -> UIImage {
        guard let ciImage = CIImage(image: self) else { return self }
        let filters: [(String, [String: Any])] = [
            ("CIColorControls", [
                kCIInputContrastKey: 1.18,
                kCIInputBrightnessKey: 0.02,
                kCIInputSaturationKey: 0.92,
            ]),
            ("CISharpenLuminance", [
                kCIInputSharpnessKey: 0.42,
            ]),
        ]
        let output = filters.reduce(ciImage) { image, filter in
            guard let ciFilter = CIFilter(name: filter.0) else { return image }
            ciFilter.setValue(image, forKey: kCIInputImageKey)
            for (key, value) in filter.1 {
                ciFilter.setValue(value, forKey: key)
            }
            return ciFilter.outputImage ?? image
        }
        let context = CIContext(options: [.useSoftwareRenderer: false])
        guard let cgImage = context.createCGImage(output, from: output.extent) else { return self }
        return UIImage(cgImage: cgImage, scale: scale, orientation: .up)
    }

    func resizedForClipOCR(maxLongEdge: CGFloat) -> UIImage {
        let longEdge = max(size.width, size.height)
        guard longEdge > maxLongEdge, longEdge > 0 else { return self }
        let ratio = maxLongEdge / longEdge
        let targetSize = CGSize(width: size.width * ratio, height: size.height * ratio)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: targetSize))
        }
    }
}
