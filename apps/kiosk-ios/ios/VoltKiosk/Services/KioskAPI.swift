import Foundation

struct KioskAPI: KioskServing {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func catalog(storeSlug: String) async throws -> KioskCatalog {
        let catalog: KioskCatalog = try await send(path: "catalog", storeSlug: storeSlug)
        guard catalog.store.slug == storeSlug,
              Set(catalog.products.map(\.id)).count == catalog.products.count,
              catalog.store.storefrontUrl.scheme == "https",
              catalog.products.allSatisfy({ product in
                  !product.id.isEmpty && !product.title.isEmpty && product.priceCents >= 0
                      && product.priceMaxCents >= product.priceCents && !product.variants.isEmpty
                      && product.url.scheme == "https" && product.images.allSatisfy { $0.scheme == "https" }
                      && Set(product.variants.map(\.id)).count == product.variants.count
                      && product.variants.allSatisfy { !$0.id.isEmpty && $0.priceCents >= 0 }
              }) else { throw KioskAPIError.invalidResponse }
        return catalog
    }

    func createRequest(storeSlug: String, productID: String, variantID: String, requestKey: String) async throws -> KioskRequestReceipt {
        try await send(path: "requests", method: "POST", body: ["storeSlug": storeSlug, "productId": productID, "variantId": variantID, "requestKey": requestKey])
    }

    func queue(storeSlug: String) async throws -> KioskQueueResponse {
        let response: KioskQueueResponse = try await send(path: "requests", storeSlug: storeSlug)
        guard response.requests.count <= 100,
              Set(response.requests.map(\.id)).count == response.requests.count,
              response.requests.allSatisfy({ $0.storeSlug == storeSlug && $0.priceCents >= 0 && ($0.imageUrl == nil || $0.imageUrl?.scheme == "https") }) else {
            throw KioskAPIError.invalidResponse
        }
        return response
    }

    func updateRequest(storeSlug: String, id: String, status: KioskRequestStatus) async throws -> KioskProductRequest {
        guard status != .waiting else { throw KioskAPIError.invalidResponse }
        let request: KioskProductRequest = try await send(path: "requests", method: "PATCH", body: ["storeSlug": storeSlug, "id": id, "status": status.rawValue])
        guard request.storeSlug == storeSlug, request.id == id else { throw KioskAPIError.invalidResponse }
        return request
    }

    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = try? Date(value, strategy: .iso8601.time(includingFractionalSeconds: true)) { return date }
            if let date = try? Date(value, strategy: .iso8601) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO date")
        }
        return decoder
    }

    private func send<Response: Decodable & Sendable>(path: String, storeSlug: String? = nil, method: String = "GET", body: [String: String]? = nil) async throws -> Response {
        guard baseURL.scheme == "https", baseURL.host != nil,
              var components = URLComponents(url: baseURL.appendingPathComponent("api/" + path), resolvingAgainstBaseURL: false) else {
            throw KioskAPIError.invalidConfiguration
        }
        if let storeSlug {
            guard StoreAddress.validSlug(storeSlug) else { throw KioskAPIError.invalidResponse }
            components.queryItems = [URLQueryItem(name: "store", value: storeSlug)]
        }
        guard let url = components.url else { throw KioskAPIError.invalidConfiguration }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: path == "catalog" ? 28 : 15)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse,
              http.url?.scheme == "https", http.url?.host == baseURL.host else { throw KioskAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ServerError.self, from: data))?.error ?? "Could not connect to the store. Try again."
            throw KioskAPIError.server(status: http.statusCode, message: message)
        }
        do { return try Self.decoder().decode(Response.self, from: data) }
        catch { throw KioskAPIError.invalidResponse }
    }

    private struct ServerError: Decodable { let error: String }
}
