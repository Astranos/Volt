import UIKit
@preconcurrency import Vision

struct RecognizedTextRegion: Identifiable, Equatable {
    let id = UUID()
    let text: String
    let boundingBox: CGRect
    let confidence: Float
}

enum TextRecognizer {
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
                    .compactMap { observation -> RecognizedTextRegion? in
                        guard let candidate = observation.topCandidates(1).first else { return nil }
                        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !text.isEmpty else { return nil }
                        return RecognizedTextRegion(
                            text: text,
                            boundingBox: observation.boundingBox,
                            confidence: candidate.confidence
                        )
                    }

                continuation.resume(returning: regions)
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
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
}
