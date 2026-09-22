import Combine
import ConvexMobile
import Foundation

@MainActor
final class CloudComputerSubscriptions {
    private let client: ConvexClient
    private let credential: CloudDeviceCredential
    private let onResponse: (ListCloudComputersResponse) -> Void
    private let onError: (Error) -> Void
    private var chain: CloudComputerPageChain
    private var tasks: [UUID: Task<Void, Never>] = [:]
    private var isActive = false

    init(client: ConvexClient, credential: CloudDeviceCredential,
         onResponse: @escaping (ListCloudComputersResponse) -> Void,
         onError: @escaping (Error) -> Void) {
        self.client = client
        self.credential = credential
        self.chain = CloudComputerPageChain(workspaceId: credential.workspaceId)
        self.onResponse = onResponse
        self.onError = onError
    }

    func start() {
        guard !isActive else { return }
        isActive = true
        subscribe(chain.start())
    }

    func stop() {
        isActive = false
        chain.stop()
        for task in tasks.values { task.cancel() }
        tasks = [:]
    }

    private func subscribe(_ request: CloudComputerPageChain.Request) {
        let publisher = client.subscribe(
            to: "cloudWorkspace:listComputersForDevicePage",
            with: ["deviceId": credential.deviceId, "deviceSecret": credential.value, "cursor": request.cursor],
            yielding: ListCloudComputersPage.self
        )
        tasks[request.id] = Task { [weak self] in
            do {
                for try await page in publisher.values {
                    guard !Task.isCancelled, let self, self.isActive else { return }
                    guard let update = try self.chain.receive(page, for: request) else { return }
                    for id in update.cancelled { self.tasks.removeValue(forKey: id)?.cancel() }
                    if let next = update.next { self.subscribe(next) }
                    if let response = update.response { self.onResponse(response) }
                }
                guard !Task.isCancelled, let self, self.isActive else { return }
                self.fail(SubscriptionEnded())
            } catch {
                guard !Task.isCancelled, let self, self.isActive else { return }
                self.fail(error)
            }
        }
    }

    private func fail(_ error: Error) {
        stop()
        onError(error)
    }

    private struct SubscriptionEnded: LocalizedError {
        var errorDescription: String? { "Computer list subscription ended. Reconnecting." }
    }
}
