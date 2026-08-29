import Foundation

enum AccessPlan: String, Decodable, Sendable {
    case free
    case pro
}

struct AccessCapabilities: Decodable, Sendable {
    let localCapture: Bool
    let cloudWorkspace: Bool
    let aiProductScanner: Bool
}

enum AIScannerQuota: Decodable, Equatable, Sendable {
    case unlimited
    case metered(limit: Int, used: Int, remaining: Int, resetsAt: Date)

    var remaining: Int? {
        guard case .metered(_, _, let remaining, _) = self else { return nil }
        return remaining
    }

    var resetsAt: Date? {
        guard case .metered(_, _, _, let resetsAt) = self else { return nil }
        return resetsAt
    }

    private enum CodingKeys: String, CodingKey {
        case kind
        case limit
        case used
        case remaining
        case resetsAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "unlimited":
            self = .unlimited
        case "metered":
            self = .metered(
                limit: try container.decode(Int.self, forKey: .limit),
                used: try container.decode(Int.self, forKey: .used),
                remaining: try container.decode(Int.self, forKey: .remaining),
                resetsAt: Date(
                    timeIntervalSince1970: try container.decode(Double.self, forKey: .resetsAt) / 1_000
                )
            )
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .kind,
                in: container,
                debugDescription: "Unknown AI scanner quota kind"
            )
        }
    }
}

struct AccessStatus: Decodable, Sendable {
    let access: AccessKind
    let plan: AccessPlan
    let capabilities: AccessCapabilities
    let aiScannerQuota: AIScannerQuota?
    let isAuthorized: Bool
    let hasFullAppAccess: Bool
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
        case plan
        case capabilities
        case aiScannerQuota
        case isAuthorized
        case hasFullAppAccess
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
        let legacyProAccess = access == .complimentary || access == .subscription
        plan = try container.decodeIfPresent(AccessPlan.self, forKey: .plan)
            ?? (legacyProAccess ? .pro : .free)
        capabilities = try container.decodeIfPresent(AccessCapabilities.self, forKey: .capabilities)
            ?? AccessCapabilities(localCapture: true, cloudWorkspace: legacyProAccess, aiProductScanner: true)
        aiScannerQuota = try container.decodeIfPresent(AIScannerQuota.self, forKey: .aiScannerQuota)
        isAuthorized = try container.decode(Bool.self, forKey: .isAuthorized)
        hasFullAppAccess = try container.decodeIfPresent(Bool.self, forKey: .hasFullAppAccess)
            ?? (access == .complimentary || access == .subscription)
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
