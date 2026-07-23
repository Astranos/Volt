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
    private(set) var errorMessage: String?
    private(set) var noticeMessage: String?

    @ObservationIgnored private let productID: String
    @ObservationIgnored private let accessStore: AccessStore
    @ObservationIgnored private var transactionUpdatesTask: Task<Void, Never>?

    init(productID: String, accessStore: AccessStore) {
        self.productID = productID
        self.accessStore = accessStore
    }

    func prepare(using clerk: Clerk) async {
        startObservingTransactions(using: clerk)
        await loadProduct()
    }

    func purchase(using clerk: Clerk) async {
        isPurchasing = true
        errorMessage = nil
        noticeMessage = nil
        defer { isPurchasing = false }

        do {
            let product = try await availableProduct()
            let appAccountToken = try await accessStore.appAccountToken(using: clerk)
            let result = try await product.purchase(options: [.appAccountToken(appAccountToken)])

            switch result {
            case .success(let verification):
                let transaction = try verifiedTransaction(from: verification)
                guard transaction.appAccountToken == appAccountToken else {
                    throw StoreKitSubscriptionError.mismatchedAppAccountToken
                }
                try await synchronize(verification, using: clerk, finishesTransaction: true)
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
        defer { isLoadingProduct = false }

        do {
            product = try await Product.products(for: [productID]).first
            if product == nil {
                throw StoreKitSubscriptionError.productUnavailable
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func availableProduct() async throws -> Product {
        if let product {
            return product
        }
        await loadProduct()
        guard let product else {
            throw StoreKitSubscriptionError.productUnavailable
        }
        return product
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
