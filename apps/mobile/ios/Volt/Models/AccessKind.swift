enum AccessKind: String, Decodable, Sendable {
    case trial
    case subscription
    case exhausted

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = AccessKind(rawValue: value) ?? .trial
    }
}
