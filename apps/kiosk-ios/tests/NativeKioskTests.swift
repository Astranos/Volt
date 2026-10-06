import Foundation

@main
struct NativeKioskTests {
    @MainActor
    static func main() async throws {
        let catalog = try KioskAPI.decoder().decode(KioskCatalog.self, from: fixtureData)
        try testModels(catalog)
        try await testHTTP(catalog)
        try await testSession(catalog)
        try await testQueue(catalog)
        if CommandLine.arguments.contains("--live") {
            let api = KioskAPI(baseURL: URL(string: "https://pm.voltresale.app")!)
            let live = try await api.catalog(storeSlug: "taylormi")
            precondition(live.store.slug == "taylormi")
            print("Live native API decoded \(live.products.count) products for \(live.store.name), status \(live.status.rawValue).")
            let queue = try await api.queue(storeSlug: "taylormi")
            print("Live queue decoded \(queue.requests.count) requests. No live writes performed.")
        }
        print("Native kiosk checks passed: data decoding, browse rules, API requests/errors, persistence, freshness, idle reset, request retries, late responses, and queue updates.")
    }

    static func testModels(_ catalog: KioskCatalog) throws {
        precondition(catalog.products.count == 2 && catalog.products[0].details.count == 4)
        precondition(catalog.products[0].formattedPrice == "From $100")
        precondition(KioskProduct.money(1050) == "$10.50")
        var filters = CatalogFilters()
        filters.query = "  phone   MI01-123 "
        precondition(filters.apply(to: catalog.products).map(\.id) == ["1"])
        filters.category = .gaming
        precondition(filters.apply(to: catalog.products).isEmpty)
        filters = CatalogFilters(budgetCents: 5000)
        precondition(filters.apply(to: catalog.products).map(\.id) == ["2"])
        filters = CatalogFilters(sort: .high)
        precondition(filters.apply(to: catalog.products).map(\.id) == ["1", "2"])
        filters.sort = .newest
        precondition(filters.apply(to: catalog.products).map(\.id) == ["2", "1"])
        precondition(!catalog.isExpired(at: catalog.checkedAt.addingTimeInterval(300)))
        precondition(catalog.isExpired(at: catalog.checkedAt.addingTimeInterval(301)))
        precondition(catalog.acceptsRequests(at: catalog.checkedAt.addingTimeInterval(59)))
        precondition(catalog.acceptsRequests(at: catalog.checkedAt.addingTimeInterval(60)))
        precondition(!catalog.acceptsRequests(at: catalog.checkedAt.addingTimeInterval(301)))
        for input in ["taylormi", "TAYLORMI", "https://taylormi.paymore.com/", "taylormi.paymore.com"] {
            precondition(StoreAddress.slug(from: input) == "taylormi")
        }
        for input in ["https://evil.example", "https://a.b.paymore.com", "https://user@taylormi.paymore.com", "https://taylormi.paymore.com:8443", "https://taylormi.paymore.com/products", "javascript:alert(1)", "taylormi?next=evil", "-taylormi", "taylormi-"] {
            precondition(StoreAddress.slug(from: input) == nil, "Rejected address expected: \(input)")
        }
    }

    static func testHTTP(_ catalog: KioskCatalog) async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FixtureURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let api = KioskAPI(baseURL: URL(string: "https://pm.voltresale.app")!, session: session)
        await FixtureURLProtocol.http.set(status: 200, data: fixtureData)
        let loaded = try await api.catalog(storeSlug: "taylormi")
        precondition(loaded.products == catalog.products)
        let read = await FixtureURLProtocol.http.lastRequest!
        precondition(read.url?.path == "/api/catalog")
        precondition(URLComponents(url: read.url!, resolvingAgainstBaseURL: false)?.queryItems == [URLQueryItem(name: "store", value: "taylormi")])
        await FixtureURLProtocol.http.set(status: 200, data: Data("{\"id\":\"receipt\",\"status\":\"waiting\",\"createdAt\":10,\"expiresAt\":20}".utf8))
        _ = try await api.createRequest(storeSlug: "taylormi", productID: "1", variantID: "11", requestKey: "12345678-1234-1234-1234-123456789abc:11")
        let write = await FixtureURLProtocol.http.lastRequest!
        precondition(write.httpMethod == "POST" && write.value(forHTTPHeaderField: "Content-Type") == "application/json")
        let sentBody = await FixtureURLProtocol.http.lastBody
        let body = try JSONDecoder().decode([String: String].self, from: sentBody)
        precondition(body["variantId"] == "11" && body["productId"] == "1" && body["requestKey"]?.hasSuffix(":11") == true)
        await FixtureURLProtocol.http.set(status: 429, data: Data("{\"error\":\"Please wait before requesting another item.\"}".utf8))
        do {
            _ = try await api.catalog(storeSlug: "taylormi")
            preconditionFailure("Expected server error")
        } catch KioskAPIError.server(let status, let message) {
            precondition(status == 429 && message.contains("Please wait"))
        }
        await FixtureURLProtocol.http.set(status: 200, data: Data("{\"products\":[]}".utf8))
        do { _ = try await api.catalog(storeSlug: "taylormi"); preconditionFailure("Expected schema rejection") }
        catch KioskAPIError.invalidResponse { }
        var wrongStore = String(decoding: fixtureData, as: UTF8.self)
        wrongStore = wrongStore.replacingOccurrences(of: "\"slug\":\"taylormi\"", with: "\"slug\":\"otherstore\"")
        await FixtureURLProtocol.http.set(status: 200, data: Data(wrongStore.utf8))
        do { _ = try await api.catalog(storeSlug: "taylormi"); preconditionFailure("Expected mismatched store rejection") }
        catch KioskAPIError.invalidResponse { }
    }

    @MainActor
    static func testSession(_ original: KioskCatalog) async throws {
        let catalog = KioskCatalog(store: original.store, products: original.products, checkedAt: .now, status: .fresh)
        let api = FixtureAPI(catalog: catalog)
        let suite = "volt-kiosk-tests-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let session = KioskSession(api: api, defaults: defaults)
        precondition(session.storeSlug == nil)
        let invalid = await session.connect(to: "https://evil.example")
        precondition(!invalid && session.storeSlug == nil && session.setupError != nil)
        let connected = await session.connect(to: "taylormi.paymore.com")
        precondition(connected && defaults.string(forKey: "kiosk.storeSlug") == "taylormi")
        let restored = KioskSession(api: api, defaults: defaults)
        precondition(restored.storeSlug == "taylormi")
        let product = catalog.products[0]
        let variant = product.variants[0]
        precondition(session.canRequest(productID: product.id))
        await api.setFailNextRequest()
        await session.request(product: product, variant: variant)
        if case .failed = session.requestState(for: variant.id) { } else { preconditionFailure("Expected retry state") }
        await session.request(product: product, variant: variant)
        if case .sent = session.requestState(for: variant.id) { } else { preconditionFailure("Expected sent receipt") }
        await session.request(product: product, variant: variant)
        let keys = await api.keys
        precondition(keys.count == 2 && keys[0] == keys[1], "Retries must use one key; a sent request must not repeat")
        let visitor = session.visitorID
        session.filters.query = "phone"
        session.selectedProduct = product
        session.productLimit = 48
        let last = session.lastActivity
        session.tick(at: last.addingTimeInterval(101))
        precondition(session.remainingIdleSeconds == 19)
        session.tick(at: last.addingTimeInterval(120))
        precondition(session.visitorID != visitor && session.selectedProduct == nil && session.filters == CatalogFilters() && session.productLimit == 24)
        precondition(session.requestState(for: variant.id) == .idle)
        session.tick(at: catalog.checkedAt.addingTimeInterval(301))
        precondition(!session.canRequest(productID: product.id))
        await api.setCatalog(KioskCatalog(store: catalog.store, products: catalog.products, checkedAt: .now, status: .stale))
        await session.refresh()
        precondition(session.isStale && !session.canRequest(productID: product.id))
        await api.setCatalog(KioskCatalog(store: catalog.store, products: [], checkedAt: .now, status: .fresh))
        await session.refresh()
        precondition(!session.canRequest(productID: product.id), "Removed product must not be requestable")
        await api.setCatalog(catalog)
        await session.refresh()
        await api.setHoldRequest(true)
        let send = Task { await session.request(product: product, variant: variant) }
        for _ in 0..<1000 {
            if await api.hasHeldRequest { break }
            await Task.yield()
        }
        let didHold = await api.hasHeldRequest
        precondition(didHold)
        await session.request(product: product, variant: variant)
        let heldKeys = await api.keys
        precondition(heldKeys.count == 3, "Double-tapping an in-flight request must not POST again")
        session.resetBrowsing()
        await api.releaseRequest()
        await send.value
        precondition(session.requestState(for: variant.id) == .idle, "Late result must not leak into the next customer session")
        await api.setHoldCatalog(true)
        let firstRefresh = Task { await session.refresh() }
        for _ in 0..<1000 {
            if await api.hasHeldCatalog { break }
            await Task.yield()
        }
        let catalogHeld = await api.hasHeldCatalog
        precondition(catalogHeld)
        let secondRefresh = Task { await session.refresh() }
        firstRefresh.cancel()
        await api.releaseCatalog()
        await firstRefresh.value
        await secondRefresh.value
        precondition(session.catalog != nil && !session.isLoading, "Replacement refresh must join the active fetch instead of skipping it")
    }

    @MainActor
    static func testQueue(_ catalog: KioskCatalog) async throws {
        let api = FixtureAPI(catalog: catalog)
        let queue = KioskRequestQueue(storeSlug: "taylormi", api: api)
        await queue.refresh()
        precondition(queue.requests.map(\.id) == ["request"] && queue.waitingCount == 1)
        await queue.update(queue.requests[0], to: .found)
        precondition(queue.requests[0].status == .found && queue.foundCount == 1)
        await queue.update(queue.requests[0], to: .shown)
        precondition(queue.requests.isEmpty)
        let offlineQueue = KioskRequestQueue(storeSlug: "taylormi", api: FixtureAPI(catalog: catalog))
        await offlineQueue.refresh()
        precondition(offlineQueue.requests.count == 1)
        offlineQueue.tick(at: Date.now.addingTimeInterval(3601))
        precondition(offlineQueue.requests.isEmpty && offlineQueue.waitingCount == 0, "Local clock must expire cached requests without a successful GET")
    }

    static let fixtureData = Data(#"""
    {"store":{"slug":"taylormi","name":"PayMore Taylor","region":"MI","address":"Taylor, MI","storefrontUrl":"https://taylormi.paymore.com"},"checkedAt":"2026-10-05T19:00:00.123Z","status":"fresh","products":[
      {"id":"1","title":"Apple Phone","category":"Phones","condition":"Good","priceCents":10000,"priceMaxCents":15000,"images":["https://cdn.shopify.com/phone.jpg"],"url":"https://taylormi.paymore.com/products/phone","description":"Unlocked phone","details":[{"kind":"heading","text":"Cosmetic Condition"},{"kind":"paragraph","text":"Light wear"},{"kind":"list","items":["Charger included"]},{"kind":"specifications","rows":[{"label":"Storage","value":"128 GB"}]}],"publishedAt":"2026-10-01T10:00:00Z","variants":[{"id":"11","title":"128 GB","priceCents":10000,"sku":"MI01-123"},{"id":"12","title":"256 GB","priceCents":15000,"sku":null}]},
      {"id":"2","title":"Game Controller","category":"Gaming","condition":"See item details","priceCents":2500,"priceMaxCents":2500,"images":[],"url":"https://taylormi.paymore.com/products/controller","description":"Wireless gamepad","details":[],"publishedAt":"2026-10-02T10:00:00.000Z","variants":[{"id":"21","title":"Default Title","priceCents":2500,"sku":"MI01-234"}]}
    ]}
    """#.utf8)
}

private actor FixtureHTTP {
    var status = 200
    var data = Data()
    private(set) var lastRequest: URLRequest?
    private(set) var lastBody = Data()
    func set(status: Int, data: Data) { self.status = status; self.data = data }
    func response(to request: URLRequest) -> (Int, Data) {
        lastRequest = request
        lastBody = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var bytes = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&bytes, maxLength: bytes.count)
                if count <= 0 { break }
                lastBody.append(contentsOf: bytes.prefix(count))
            }
        }
        return (status, data)
    }
}

private final class FixtureURLProtocol: URLProtocol, @unchecked Sendable {
    static let http = FixtureHTTP()
    private var responseTask: Task<Void, Never>?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        responseTask = Task {
            let (status, data) = await Self.http.response(to: request)
            guard !Task.isCancelled else { return }
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() { responseTask?.cancel() }
}

private actor FixtureAPI: KioskServing {
    var snapshot: KioskCatalog
    private(set) var keys: [String] = []
    private var failNextRequest = false
    private var holdRequest = false
    private var heldRequest: CheckedContinuation<KioskRequestReceipt, Never>?
    private var queueStatus = KioskRequestStatus.waiting
    private var holdCatalog = false
    private var heldCatalog: CheckedContinuation<KioskCatalog, Never>?
    init(catalog: KioskCatalog) { snapshot = catalog }
    var hasHeldRequest: Bool { heldRequest != nil }
    var hasHeldCatalog: Bool { heldCatalog != nil }
    func setHoldCatalog(_ value: Bool) { holdCatalog = value }
    func releaseCatalog() { heldCatalog?.resume(returning: snapshot); heldCatalog = nil; holdCatalog = false }
    func setCatalog(_ value: KioskCatalog) { snapshot = value }
    func setFailNextRequest() { failNextRequest = true }
    func setHoldRequest(_ value: Bool) { holdRequest = value }
    func catalog(storeSlug: String) async throws -> KioskCatalog {
        if holdCatalog { return await withCheckedContinuation { heldCatalog = $0 } }
        return snapshot
    }
    func createRequest(storeSlug: String, productID: String, variantID: String, requestKey: String) async throws -> KioskRequestReceipt {
        keys.append(requestKey)
        if failNextRequest { failNextRequest = false; throw KioskAPIError.server(status: 503, message: "Try again") }
        if holdRequest { return await withCheckedContinuation { heldRequest = $0 } }
        return receipt
    }
    var receipt: KioskRequestReceipt { KioskRequestReceipt(id: "receipt", status: .waiting, createdAt: 1, expiresAt: Date.now.timeIntervalSince1970 * 1000 + 3600000) }
    func releaseRequest() { heldRequest?.resume(returning: receipt); heldRequest = nil }
    func queue(storeSlug: String) async throws -> KioskQueueResponse {
        let now = Date.now.timeIntervalSince1970 * 1000
        let active = request(status: queueStatus, expiresAt: now + 3600000)
        let expired = request(status: .waiting, expiresAt: now - 1, id: "expired")
        return KioskQueueResponse(requests: [expired, active], serverNow: now)
    }
    func updateRequest(storeSlug: String, id: String, status: KioskRequestStatus) async throws -> KioskProductRequest {
        queueStatus = status
        return request(status: status, expiresAt: Date.now.timeIntervalSince1970 * 1000 + 3600000)
    }
    private func request(status: KioskRequestStatus, expiresAt: Double, id: String = "request") -> KioskProductRequest {
        KioskProductRequest(id: id, storeSlug: "taylormi", productId: "1", variantId: "11", title: "Apple Phone", variantTitle: "128 GB", sku: "MI01-123", imageUrl: nil, priceCents: 10000, productUrl: URL(string: "https://taylormi.paymore.com/products/phone")!, status: status, createdAt: 1, updatedAt: 1, expiresAt: expiresAt)
    }
}
