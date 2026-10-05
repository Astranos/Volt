import SwiftUI

struct KioskView: View {
    private let api: KioskAPI?
    @State private var session: KioskSession?

    init() {
        let api = KioskConfiguration.apiBaseURL.map { KioskAPI(baseURL: $0) }
        self.api = api
        _session = State(initialValue: api.map { KioskSession(api: $0, defaultStoreSlug: KioskConfiguration.defaultStoreSlug) })
    }

    var body: some View {
        if let session, let api {
            KioskRootContentView(session: session, api: api)
        } else {
            ContentUnavailableView("Server configuration missing", systemImage: "gearshape", description: Text("Ask staff to check the app’s bundled HTTPS server address."))
        }
    }
}
