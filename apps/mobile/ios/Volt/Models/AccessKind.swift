enum AccessKind: String, Decodable, Sendable {
    case trial
    case complimentary
    case subscription
    case exhausted
}
