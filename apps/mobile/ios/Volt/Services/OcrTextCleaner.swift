import FoundationModels
import Foundation

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
        let normalized = text
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let match = LiveTextIdentifierMatcher.match(normalized) {
            return match.value
        }
        return normalized
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
