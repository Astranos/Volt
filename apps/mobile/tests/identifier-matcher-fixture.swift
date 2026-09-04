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

        print("identifier matcher fixtures passed")
    }
}
