import FoundationModels
import Foundation

struct OcrTextCleanupResult: Equatable {
    let text: String
    let usedFoundationModel: Bool
}

enum OcrTextCleaner {
    static func clean(text: String, context: String = "") async -> OcrTextCleanupResult {
        let fallbackText = deterministicCleanup(text, context: context)
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
            Use nearby OCR context only to identify what the selected snippet represents. If it contains a serial number, model number, SKU, code, URL, email, phone number, or identifier with OCR artifacts before or after it, return only the intended value.
            If context identifies an Apple hardware serial, resolve an O or Q that is an obvious OCR rendering of 0, but do not make that substitution for generic identifiers.
            Preserve exact casing, punctuation, separators, and digits unless an OCR error is obvious.
            Do not return any nearby context. Do not expand abbreviations. Do not explain. Do not add labels or surrounding quotes.
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

                Selected OCR text:
                \(fallbackText)

                Nearby OCR context (reference only; never return it):
                \(context)
                """,
                options: options
            )
            let sanitizedText = sanitizeModelOutput(response.content, fallback: fallbackText, context: context)
            return OcrTextCleanupResult(
                text: authoritativeCleanup(sanitizedText, context: context),
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

    private static func deterministicCleanup(_ text: String, context: String) -> String {
        let normalized = text
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let imei = repairedIMEI(in: normalized) {
            return imei
        }
        if let match = LiveTextIdentifierMatcher.match(normalized) {
            if match.kind == .serial, isAppleSerialContext(context) {
                return repairAppleSerialCharacters(in: match.value)
            }
            return match.value
        }
        return normalized
    }

    private static func sanitizeModelOutput(_ output: String, fallback: String, context: String) -> String {
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
        if cleaned.contains(where: \.isNewline) {
            cleaned = cleaned.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        }
        let contextLines = context
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        if contextLines.contains(where: { $0.caseInsensitiveCompare(cleaned) == .orderedSame })
            || contextLines.contains(where: { $0.count >= 4 && cleaned.localizedCaseInsensitiveContains($0) }) {
            return fallback
        }
        return cleaned.isEmpty ? fallback : cleaned
    }

    private static func authoritativeCleanup(_ text: String, context: String) -> String {
        if let imei = repairedIMEI(in: text) {
            return imei
        }
        if isAppleSerialContext(context) {
            return repairAppleSerialCharacters(in: text)
        }
        return deterministicCleanup(text, context: context)
    }

    private static func isAppleSerialContext(_ context: String) -> Bool {
        let lowercased = context.lowercased()
        let appleTerms = ["apple", "iphone", "ipad", "macbook", "mac mini", "imac", "airpods", "apple watch"]
        let serialTerms = ["serial", "s/n", "s. n.", "sn", "selected identifier type: serial"]
        return appleTerms.contains(where: lowercased.contains)
            && serialTerms.contains(where: lowercased.contains)
    }

    private static func repairAppleSerialCharacters(in value: String) -> String {
        String(value.map { character in
            switch character {
            case "O", "o", "Q", "q":
                return "0"
            default:
                return character
            }
        })
    }

    private static func repairedIMEI(in text: String) -> String? {
        let candidates = text.filter { $0.isNumber || $0 == "O" || $0 == "o" || $0 == "Q" || $0 == "q" }
        guard candidates.count >= 15 else { return nil }
        let characters = Array(candidates)
        for start in 0...(characters.count - 15) {
            let candidate = characters[start..<start + 15].map { character in
                character.isNumber ? character : "0"
            }
            let value = String(candidate)
            guard isValidLuhn(value) else { continue }
            return value
        }
        return nil
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
