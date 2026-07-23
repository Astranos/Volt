import Foundation

struct AccessStatus: Decodable, Sendable {
    let access: AccessKind
    let isAuthorized: Bool
    let freeSessionsRemaining: Int
    let requiresSignIn: Bool
    let requiresSubscription: Bool
    let subscriptionStatus: VoltSubscriptionStatus
    let productId: String
    let clerkUserId: String?
    let organizationId: String?
    let appAccountToken: UUID?
    let expiresAt: Date?

    private enum CodingKeys: String, CodingKey {
        case access
        case isAuthorized
        case freeSessionsRemaining
        case requiresSignIn
        case requiresSubscription
        case subscriptionStatus
        case productId
        case clerkUserId
        case organizationId
        case appAccountToken
        case expiresAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        access = try container.decode(AccessKind.self, forKey: .access)
        isAuthorized = try container.decode(Bool.self, forKey: .isAuthorized)
        freeSessionsRemaining = try container.decode(Int.self, forKey: .freeSessionsRemaining)
        requiresSignIn = try container.decode(Bool.self, forKey: .requiresSignIn)
        requiresSubscription = try container.decode(Bool.self, forKey: .requiresSubscription)
        subscriptionStatus = try container.decode(VoltSubscriptionStatus.self, forKey: .subscriptionStatus)
        productId = try container.decodeIfPresent(String.self, forKey: .productId)
            ?? AppConfiguration.defaultStoreKitProductID
        clerkUserId = try container.decodeIfPresent(String.self, forKey: .clerkUserId)
        organizationId = try container.decodeIfPresent(String.self, forKey: .organizationId)
        appAccountToken = try container.decodeIfPresent(UUID.self, forKey: .appAccountToken)

        if let date = try? container.decodeIfPresent(Date.self, forKey: .expiresAt) {
            expiresAt = date
        } else if let value = try container.decodeIfPresent(String.self, forKey: .expiresAt) {
            expiresAt = try? Date(value, strategy: .iso8601)
        } else {
            expiresAt = nil
        }
    }
}
