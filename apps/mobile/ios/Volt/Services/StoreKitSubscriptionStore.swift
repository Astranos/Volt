import ClerkKit
import Observation
import StoreKit

@MainActor
@Observable
final class StoreKitSubscriptionStore {
    private(set) var product: Product?
    private(set) var isLoadingProduct = false
    private(set) var isPurchasing = false
    private(set) var isRestoring = false
    private(set) var introductoryTrialPeriod: String?
    private(set) var errorMessage: String?
    private(set) var noticeMessage: String?
    private(set) var hasAttemptedProductLoad = false

    @ObservationIgnored private let productID: String
    @ObservationIgnored private let accessStore: AccessStore
    @ObservationIgnored private var transactionUpdatesTask: Task<Void, Never>?

    init(productID: String, accessStore: AccessStore) {
        self.productID = productID
        self.accessStore = accessStore
    }

    /// Subscription name, billing length, and price, sourced only from StoreKit so the
    /// purchase screen never advertises a price the App Store cannot honor.
    var planSummary: String? {
        guard let product, let subscription = product.subscription else { return nil }
        let period = Self.renewalPeriodDescription(subscription.subscriptionPeriod)
        if let introductoryTrialPeriod {
            return "\(product.displayName): \(introductoryTrialPeriod) free, then \(product.displayPrice) per \(period)."
        }
        return "\(product.displayName): \(product.displayPrice) per \(period)."
    }

    var renewalDisclosure: String {
        "The subscription renews automatically at the price above unless it is canceled at least 24 hours before the current period ends. Manage or cancel in App Store account settings."
    }

    /// False once StoreKit has been asked for the product and returned nothing, which
    /// happens whenever the subscription is rejected, removed, or unavailable in the
    /// current storefront. The paywall needs this to avoid rendering an empty screen.
    var isProductUnavailable: Bool {
        product == nil && !isLoadingProduct && hasAttemptedProductLoad
    }

    func prepare(using clerk: Clerk) async {
        startObservingTransactions(using: clerk)
        await loadProduct()
    }

    func reloadProduct() async {
        await loadProduct()
    }

    /// Ties every App Store purchase to the signed-in Volt account.
    func purchaseOptions(using clerk: Clerk) async -> Set<Product.PurchaseOption> {
        do {
            let appAccountToken = try await accessStore.appAccountToken(using: clerk)
            errorMessage = nil
            return [.appAccountToken(appAccountToken)]
        } catch {
            errorMessage = error.localizedDescription
            return []
        }
    }

    func completePurchase(
        _ result: Result<Product.PurchaseResult, any Error>,
        using clerk: Clerk
    ) async {
        isPurchasing = true
        errorMessage = nil
        noticeMessage = nil
        defer { isPurchasing = false }

        do {
            switch try result.get() {
            case .success(let verification):
                let appAccountToken = try await accessStore.appAccountToken(using: clerk)
                let transaction = try verifiedTransaction(from: verification)
                guard transaction.appAccountToken == appAccountToken else {
                    throw StoreKitSubscriptionError.mismatchedAppAccountToken
                }
                try await synchronize(verification, using: clerk, finishesTransaction: true)
                await accessStore.refresh(using: clerk)
                noticeMessage = "Your purchase was verified. Volt access is up to date."
            case .pending:
                noticeMessage = "The purchase is pending App Store approval."
            case .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func restore(using clerk: Clerk) async {
        isRestoring = true
        errorMessage = nil
        noticeMessage = nil
        defer { isRestoring = false }

        do {
            guard clerk.user != nil else {
                throw MobileAccessError.signInRequired
            }
            try await AppStore.sync()
            try await synchronizeCurrentEntitlements(using: clerk)
            await accessStore.refresh(using: clerk)
            noticeMessage = "App Store purchases were restored and checked by Volt."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func synchronizeCurrentEntitlements(using clerk: Clerk) async throws {
        guard clerk.user != nil else { return }

        for await verification in Transaction.currentEntitlements {
            guard verification.unsafePayloadValue.productID == productID else { continue }
            try await synchronize(verification, using: clerk, finishesTransaction: true)
        }
    }

    func refreshCurrentEntitlements(using clerk: Clerk) async {
        do {
            try await synchronizeCurrentEntitlements(using: clerk)
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
            await accessStore.refresh(using: clerk)
        }
    }

    private func loadProduct() async {
        guard product == nil else { return }
        isLoadingProduct = true
        defer {
            isLoadingProduct = false
            hasAttemptedProductLoad = true
        }

        do {
            product = try await Product.products(for: [productID]).first
            if product == nil {
                throw StoreKitSubscriptionError.productUnavailable
            }
            errorMessage = nil
            await refreshIntroductoryOfferEligibility()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func refreshIntroductoryOfferEligibility() async {
        guard let subscription = product?.subscription,
              let offer = subscription.introductoryOffer,
              offer.paymentMode == .freeTrial,
              await subscription.isEligibleForIntroOffer
        else {
            introductoryTrialPeriod = nil
            return
        }
        introductoryTrialPeriod = Self.periodDescription(offer.period)
    }

    /// Compact length-and-price line for the purchase button, reading as
    /// "7 Days free, then <price>/month". Sourced only from StoreKit, like `planSummary`.
    static func purchaseCaption(for product: Product, activeOffer: Product.SubscriptionOffer?) -> String {
        guard let subscription = product.subscription else { return product.displayPrice }
        let period = renewalPeriodDescription(subscription.subscriptionPeriod)
        if let activeOffer, activeOffer.paymentMode == .freeTrial {
            return "\(periodDescription(activeOffer.period)) free, then \(product.displayPrice)/\(period)"
        }
        return "\(product.displayPrice)/\(period)"
    }

    private static func periodDescription(_ period: Product.SubscriptionPeriod) -> String {
        let unit: String
        switch period.unit {
        case .day:
            unit = "Day"
        case .week:
            unit = "Week"
        case .month:
            unit = "Month"
        case .year:
            unit = "Year"
        @unknown default:
            unit = "Period"
        }
        return "\(period.value) \(unit)\(period.value == 1 ? "" : "s")"
    }

    /// Lower-cased billing length that reads naturally after "per", e.g. "month" or "3 months".
    private static func renewalPeriodDescription(_ period: Product.SubscriptionPeriod) -> String {
        let unit: String
        switch period.unit {
        case .day:
            unit = "day"
        case .week:
            unit = "week"
        case .month:
            unit = "month"
        case .year:
            unit = "year"
        @unknown default:
            unit = "period"
        }
        return period.value == 1 ? unit : "\(period.value) \(unit)s"
    }

    private func verifiedTransaction(
        from verification: VerificationResult<Transaction>
    ) throws -> Transaction {
        switch verification {
        case .verified(let transaction):
            transaction
        case .unverified:
            throw StoreKitSubscriptionError.unverifiedTransaction
        }
    }

    private func synchronize(
        _ verification: VerificationResult<Transaction>,
        using clerk: Clerk,
        finishesTransaction: Bool
    ) async throws {
        let transaction = try verifiedTransaction(from: verification)
        guard transaction.productID == productID else { return }

        try await accessStore.synchronize(
            signedTransaction: verification.jwsRepresentation,
            using: clerk
        )
        if finishesTransaction {
            await transaction.finish()
        }
    }

    private func startObservingTransactions(using clerk: Clerk) {
        guard transactionUpdatesTask == nil else { return }
        transactionUpdatesTask = Task { [weak self] in
            for await verification in Transaction.updates {
                guard let self, clerk.user != nil else { continue }
                do {
                    try await self.synchronize(
                        verification,
                        using: clerk,
                        finishesTransaction: true
                    )
                } catch {
                    self.errorMessage = error.localizedDescription
                }
            }
        }
    }
}
