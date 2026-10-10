import Foundation
import Observation

@MainActor
@Observable
final class KioskSession {
    enum CatalogPhase {
        case unconfigured
        case loading
        case ready(KioskCatalog)
        case failed(String)
    }

    private(set) var storeSlug: String?
    private(set) var phase = CatalogPhase.unconfigured
    private(set) var visibleProducts: [KioskProduct] = []
    private(set) var refreshError: String?
    private(set) var setupError: String?
    private(set) var isConnecting = false
    private(set) var visitorID = UUID()
    private(set) var resetID = UUID()
    private(set) var now: Date
    private(set) var lastActivity: Date
    var selectedProduct: KioskProduct?
    var productLimit = 24
    var filters = CatalogFilters() {
        didSet {
            visibleProducts = filters.apply(to: catalog?.products ?? [])
            productLimit = 24
            recordActivity()
        }
    }

    @ObservationIgnored private let api: any KioskServing
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var refreshToken: UUID?
    @ObservationIgnored private var refreshTask: Task<KioskCatalog, Error>?
    @ObservationIgnored private var requestTasks: [String: Task<KioskRequestReceipt, Error>] = [:]
    private var requestStates: [String: CustomerRequestState] = [:]

    init(api: any KioskServing, defaults: UserDefaults = .standard, defaultStoreSlug: String? = nil, now: Date = .now) {
        self.api = api
        self.defaults = defaults
        self.now = now
        self.lastActivity = now
        let saved = defaults.string(forKey: "kiosk.storeSlug") ?? defaultStoreSlug
        self.storeSlug = saved.flatMap { StoreAddress.validSlug($0) ? $0 : nil }
        if storeSlug != nil { phase = .loading }
    }

    var catalog: KioskCatalog? {
        if case .ready(let catalog) = phase { return catalog }
        return nil
    }

    var isLoading: Bool {
        if case .loading = phase { return true }
        return false
    }

    var errorMessage: String? {
        if case .failed(let message) = phase { return message }
        if catalogExpired { return "Inventory has not updated in five minutes. Reconnect or ask an associate." }
        return refreshError
    }

    var isStale: Bool { catalog?.status == .stale || refreshError != nil }
    var catalogExpired: Bool { catalog?.isExpired(at: now) == true }
    var remainingIdleSeconds: Int? {
        guard storeSlug != nil else { return nil }
        let remaining = Int(ceil(120 - now.timeIntervalSince(lastActivity)))
        return remaining <= 20 ? max(0, remaining) : nil
    }

    func connect(to address: String) async -> Bool {
        guard !isConnecting else { return false }
        guard let slug = StoreAddress.slug(from: address) else {
            setupError = "Enter a PayMore store address, such as southfieldmi.paymore.com."
            return false
        }
        isConnecting = true
        setupError = nil
        defer { isConnecting = false }
        do {
            let catalog = try await api.catalog(storeSlug: slug)
            try Task.checkCancellation()
            guard catalog.store.slug == slug else { throw KioskAPIError.invalidResponse }
            refreshTask?.cancel()
            refreshTask = nil
            refreshToken = nil
            storeSlug = slug
            defaults.set(slug, forKey: "kiosk.storeSlug")
            setCatalog(catalog)
            resetBrowsing()
            return true
        } catch is CancellationError {
            return false
        } catch {
            setupError = Self.message(for: error)
            return false
        }
    }

    func refresh() async {
        guard let slug = storeSlug else { return }
        let token: UUID
        let task: Task<KioskCatalog, Error>
        if let existing = refreshTask, let existingToken = refreshToken {
            task = existing
            token = existingToken
        } else {
            token = UUID()
            task = Task { [api] in try await api.catalog(storeSlug: slug) }
            refreshToken = token
            refreshTask = task
            if catalog == nil { phase = .loading }
        }
        do {
            let catalog = try await task.value
            guard refreshToken == token, storeSlug == slug else { return }
            guard catalog.store.slug == slug else { throw KioskAPIError.invalidResponse }
            setCatalog(catalog)
        } catch {
            if refreshToken == token, storeSlug == slug, !task.isCancelled {
                let message = Self.message(for: error)
                if catalog != nil { refreshError = message }
                else { phase = .failed(message) }
            }
        }
        if refreshToken == token {
            refreshToken = nil
            refreshTask = nil
        }
    }

    func recordActivity() {
        now = .now
        lastActivity = now
    }

    func tick(at date: Date = .now) {
        now = date
        if storeSlug != nil, date.timeIntervalSince(lastActivity) >= 120 {
            resetBrowsing(at: date)
        }
    }

    func resetBrowsing() { resetBrowsing(at: .now) }

    func latestProduct(for product: KioskProduct) -> KioskProduct {
        catalog?.products.first(where: { $0.id == product.id }) ?? product
    }

    func canRequest(productID: String) -> Bool {
        guard let catalog else { return false }
        return refreshError == nil && catalog.acceptsRequests(at: now)
            && catalog.products.contains(where: { $0.id == productID })
    }

    func requestState(for variantID: String) -> CustomerRequestState {
        requestStates[variantID] ?? .idle
    }

    func request(product: KioskProduct, variant: KioskProduct.Variant) async {
        recordActivity()
        guard let slug = storeSlug, requestTasks[variant.id] == nil else { return }
        if case .sent = requestState(for: variant.id) { return }
        guard canRequest(productID: product.id),
              catalog?.products.first(where: { $0.id == product.id })?.variants.contains(where: { $0.id == variant.id }) == true else {
            requestStates[variant.id] = .failed("Availability cannot be confirmed. Refresh the catalog or ask an associate.")
            return
        }
        let visitor = visitorID
        let key = visitor.uuidString.lowercased() + ":" + variant.id
        requestStates[variant.id] = .sending
        let task = Task { [api] in
            try await api.createRequest(storeSlug: slug, productID: product.id, variantID: variant.id, requestKey: key)
        }
        requestTasks[variant.id] = task
        do {
            let receipt = try await task.value
            guard visitorID == visitor, storeSlug == slug else { return }
            requestStates[variant.id] = .sent(receipt)
        } catch {
            guard visitorID == visitor, storeSlug == slug else { return }
            requestStates[variant.id] = .failed(Self.message(for: error))
        }
        requestTasks[variant.id] = nil
    }

    private func setCatalog(_ catalog: KioskCatalog) {
        phase = .ready(catalog)
        refreshError = nil
        visibleProducts = filters.apply(to: catalog.products)
        now = .now
    }

    private func resetBrowsing(at date: Date) {
        selectedProduct = nil
        filters = CatalogFilters()
        productLimit = 24
        visitorID = UUID()
        resetID = UUID()
        requestTasks.values.forEach { $0.cancel() }
        requestTasks.removeAll()
        requestStates.removeAll()
        now = date
        lastActivity = date
    }

    private static func message(for error: Error) -> String {
        if let error = error as? URLError {
            return error.code == .timedOut ? "Connection timed out. Try again." : "Could not connect. Check the iPad’s internet connection and try again."
        }
        return error.localizedDescription
    }
}
