struct MobileAccessErrorResponse: Decodable, Sendable {
    let error: String?
    let detail: String?
}
