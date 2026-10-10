import Foundation

protocol KioskServing: Sendable {
    func catalog(storeSlug: String) async throws -> KioskCatalog
    func createRequest(storeSlug: String, productID: String, variantID: String, requestKey: String) async throws -> KioskRequestReceipt
    func queue(storeSlug: String) async throws -> KioskQueueResponse
    func updateRequest(storeSlug: String, id: String, status: KioskRequestStatus) async throws -> KioskProductRequest
}
