import Foundation

private struct FixtureFailure: Error, CustomStringConvertible {
    let description: String
}

private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw FixtureFailure(description: message) }
}

private func requireMatch(
    _ input: String,
    kind: LiveTextCandidateKind,
    value: String,
    rangeText: String? = nil
) throws {
    guard let match = LiveTextIdentifierMatcher.match(input) else {
        throw FixtureFailure(description: "Expected a match for \(input)")
    }
    try require(match.kind == kind, "Expected \(kind.rawValue) for \(input), got \(match.kind.rawValue)")
    try require(match.value == value, "Expected \(value) for \(input), got \(match.value)")
    try require(String(input[match.range]) == (rangeText ?? value), "Unexpected source range for \(input)")
}

@main
private enum IdentifierMatcherFixture {
    static func main() throws {
        try requireMatch(
            "MHWP4AM/A Air",
            kind: .model,
            value: "MHWP4AM/A",
            rangeText: "MHWP4AM/A"
        )

        for prose in ["Model Serial", "Serial Samsung", "Serial Description"] {
            try require(LiveTextIdentifierMatcher.match(prose) == nil, "Matched prose-only labeled value: \(prose)")
        }
        try requireMatch("Serial 1234567890", kind: .serial, value: "1234567890")
        try require(
            LiveTextIdentifierMatcher.standaloneValue(in: "1234567890", kind: .serial) == "1234567890",
            "A numeric serial next to a separate serial label should remain eligible"
        )

        let serialCases = [
            ("S7LBNSOWC00466H", "S7LBNS0WC00466H"),
            ("S7LBNSOWC00477V", "S7LBNS0WC00477V"),
            ("S7LBNSOWC00428Y", "S7LBNS0WC00428Y"),
            ("S7LBNS0WC00474Y", "S7LBNS0WC00474Y"),
            ("S7LBNSOWCOO466H", "S7LBNS0WC00466H"),
            ("S7LBNSoWCoo466H", "S7LBNS0WC00466H"),
        ]
        for (source, expected) in serialCases {
            try requireMatch(source, kind: .serial, value: expected, rangeText: source)
            try requireMatch("Serial No. \(source)", kind: .serial, value: expected, rangeText: source)
            try require(
                LiveTextIdentifierMatcher.standaloneValue(in: source, kind: .serial) == expected,
                "Standalone serial normalization failed for \(source)"
            )
        }

        try requireMatch("Model AB12O34", kind: .model, value: "AB12034", rangeText: "AB12O34")
        try requireMatch("Model DDR5-6O00-OC", kind: .model, value: "DDR5-6000-OC", rangeText: "DDR5-6O00-OC")
        try requireMatch("Model DDR5-6O00-OG", kind: .model, value: "DDR5-6000-OG", rangeText: "DDR5-6O00-OG")
        try require(
            LiveTextIdentifierMatcher.standaloneValue(in: "SKUO1234", kind: .sku) == "SKUO1234",
            "SKU normalization must not rewrite O"
        )
        try require(
            LiveTextIdentifierMatcher.match("Product Overview") == nil,
            "Arbitrary OCR text must not be normalized into an identifier"
        )

        // Real label captures: Code 39 delimiters, slashed zeros, scratch diacritics,
        // Microsoft value-before-label rows, and Apple's 10-character randomized serials.
        try requireMatch("*G424M011000797*", kind: .serial, value: "G424M011000797", rangeText: "G424M011000797")
        try requireMatch("*G424M011ØØØ797*", kind: .serial, value: "G424M011000797", rangeText: "G424M011ØØØ797")
        try requireMatch("ME556428549ŘŚ", kind: .serial, value: "ME556428549", rangeText: "ME556428549")
        try requireMatch("Serial ME556428549ŘŚ", kind: .serial, value: "ME556428549", rangeText: "ME556428549")
        try requireMatch("250415443948 :Serial Numb", kind: .serial, value: "250415443948")
        try requireMatch("057636134008 : Serial Nur", kind: .serial, value: "057636134008")
        try requireMatch("250415443948:Serial Number", kind: .serial, value: "250415443948")
        try requireMatch("S/N:601-7C02-050P1912005308", kind: .serial, value: "601-7C02-050P1912005308")
        try requireMatch("Serial HJTYWGYQ90", kind: .serial, value: "HJTYWGYQ90")
        try requireMatch("HJTYWGYQ90", kind: .serial, value: "HJTYWGYQ90")
        try requireMatch("COWGWK95H4", kind: .serial, value: "C0WGWK95H4", rangeText: "COWGWK95H4")
        try requireMatch("Model A3058 EMC 3585", kind: .model, value: "A3058")
        try requireMatch("Model A3058 Serial", kind: .model, value: "A3058")
        for prose in ["BLOOMINGTON", "TOMAHAWK MAX", "2014-09-25 :MFR Date", "Consumo de energia 180,0 WH"] {
            try require(LiveTextIdentifierMatcher.match(prose) == nil, "Matched prose as an identifier: \(prose)")
        }

        // Cleanup of a tapped region: Apple serials contain Q (never O or I), and a long number
        // must not be cut into a made-up IMEI unless IMEI is on screen.
        let appleContext = "Model Number MXUT3LL/A\nSerial Number FCC9J3NQCQ\niPhone 16 Plus"
        let cleanupCases: [(text: String, context: String, expected: String)] = [
            ("FCC9J3NQCQ", appleContext, "FCC9J3NQCQ"),
            ("Serial Number FCC9J3NQCQ", appleContext, "FCC9J3NQCQ"),
            ("FCC9J3NOCI", appleContext, "FCC9J3N0C1"),
            ("06406422057636134008 :Product Id", "Xbox 360", "06406422057636134008 :Product Id"),
            ("IMEI 35 209900 176148 1", "", "352099001761481"),
        ]
        for testCase in cleanupCases {
            let cleaned = OcrTextCleaner.deterministicCleanup(testCase.text, context: testCase.context)
            try require(cleaned == testCase.expected, "Cleanup of \(testCase.text) gave \(cleaned), expected \(testCase.expected)")
        }

        print("identifier matcher fixtures passed")
    }
}
