import ClerkKit
import Foundation
import Observation
import UIKit

struct CaptureOwnershipConflict: Identifiable, Equatable {
    let currentClerkUserId: String
    let recordIds: Set<UUID>
    let priorOwnerClerkUserIds: [String]
    let exportText: String
    let exportPhotoURLs: [URL]

    var id: String {
        ([currentClerkUserId] + priorOwnerClerkUserIds + recordIds.map(\.uuidString).sorted()).joined(separator: ":")
    }

    var count: Int { recordIds.count }
}

struct CursorDeliveryResolution: Equatable, Sendable {
    let resultId: UUID
    let state: ScanResult.DeliveryState
    let errorCode: String?
}

private struct InFlightDelivery: Equatable, Sendable {
    let resultId: UUID
    let giveUpAt: Date
}

@MainActor
@Observable
final class CloudWorkspaceStore {
    private(set) var credential: CloudDeviceCredential?
    private(set) var isEnrolling = false
    private(set) var isBootstrapping = false
    private(set) var isSyncing = false
    private(set) var lastError: String?
    private(set) var computers: [CloudComputer] = []
    private(set) var selectedTargetDeviceId: String?
    private(set) var accountSwitchConflict: CaptureOwnershipConflict?

    @ObservationIgnored private let api: MobileCloudAPI
    @ObservationIgnored private let outbox: DurableCaptureOutbox
    @ObservationIgnored private var authenticatedClerkUserId: String?
    @ObservationIgnored private var lastBootstrappedClerkUserId: String?
    @ObservationIgnored private var clerkForBootstrap: Clerk?
    @ObservationIgnored private var syncTask: Task<Void, Never>?
    @ObservationIgnored private var retryTask: Task<Void, Never>?
    @ObservationIgnored private var syncRequestedWhileDraining = false
    @ObservationIgnored private var inFlightDeliveries: [String: InFlightDelivery] = [:]
    @ObservationIgnored private var bufferedDeliveryResolutions: [CursorDeliveryResolution] = []
    @ObservationIgnored private var isPollingDeliveries = false

    init(
        api: MobileCloudAPI = MobileCloudAPIClient(baseURL: AppConfiguration.convexSiteURL),
        outbox: DurableCaptureOutbox? = nil
    ) {
        self.api = api
        self.outbox = outbox ?? DurableCaptureOutbox()
        self.credential = DeviceCredentialStore.load()
    }

    var workspaceId: String? { activeCredential?.workspaceId }
    var pendingCount: Int { outbox.records.count { $0.state != .uploaded } }
    var restoredResults: [ScanResult] { outbox.restoredResults }
    var availableComputers: [CloudComputer] {
        computers
            .filter { $0.online && $0.supportsCursorInsertion }
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    }
    var selectedComputer: CloudComputer? {
        guard let selectedTargetDeviceId else { return nil }
        return availableComputers.first { $0.deviceId == selectedTargetDeviceId }
    }

    func persist(_ result: ScanResult, photoData: Data? = nil) throws {
        let credential = activeCredential
        try outbox.enqueue(
            result: result,
            photoData: photoData,
            ownerClerkUserId: credential?.clerkUserId,
            workspaceId: credential?.workspaceId
        )
        requestSync()
    }

    func remove(resultId: UUID) {
        try? outbox.remove(id: resultId)
        updateOwnershipConflict()
    }

    func bootstrapIfNeeded(using clerk: Clerk) async {
        guard let clerkUserId = clerk.user?.id else {
            pauseForSignOut()
            return
        }
        authenticatedClerkUserId = clerkUserId
        clerkForBootstrap = clerk

        if let credential,
           credential.clerkUserId == clerkUserId,
           lastBootstrappedClerkUserId == clerkUserId {
            do {
                try outbox.reconcileOwnership(
                    ownerClerkUserId: clerkUserId,
                    workspaceId: credential.workspaceId
                )
                updateOwnershipConflict()
                requestSync()
                await refreshComputers()
            } catch {
                lastError = error.localizedDescription
            }
            return
        }

        guard !isBootstrapping else { return }
        cancelUploadTasks()
        isBootstrapping = true
        defer { isBootstrapping = false }

        do {
            let bearerToken = try await freshBearerToken(using: clerk)
            let response = try await bootstrapResponse(
                bearerToken: bearerToken,
                clerkUserId: clerkUserId
            )
            let nextCredential = CloudDeviceCredential(
                value: response.deviceSecret,
                deviceId: response.deviceId,
                workspaceId: response.workspaceId,
                ownerClerkUserId: response.clerkUserId,
                enrolledAt: .now
            )
            try DeviceCredentialStore.save(nextCredential)
            credential = nextCredential
            lastBootstrappedClerkUserId = response.clerkUserId
            try outbox.reconcileOwnership(
                ownerClerkUserId: response.clerkUserId,
                workspaceId: response.workspaceId
            )
            updateOwnershipConflict()
            lastError = nil
            requestSync()
            await refreshComputers()
        } catch is CancellationError {
            return
        } catch {
            lastError = error.localizedDescription
            requestSync()
        }
    }

    func enroll(_ enrollment: DeviceEnrollment) async {
        guard !isEnrolling else { return }
        isEnrolling = true
        defer { isEnrolling = false }
        do {
            let response = try await api.exchangeEnrollment(DeviceEnrollmentRequest(
                enrollmentCode: enrollment.token,
                label: Self.installationLabel
            ))
            let credential = CloudDeviceCredential(
                value: response.deviceSecret,
                deviceId: response.deviceId,
                workspaceId: response.workspaceId,
                ownerClerkUserId: nil,
                enrolledAt: .now
            )
            try DeviceCredentialStore.save(credential)
            self.credential = credential
            lastError = nil
            if let clerkForBootstrap {
                await bootstrapIfNeeded(using: clerkForBootstrap)
            }
        } catch {
            lastError = error.localizedDescription
        }
    }

    func refreshComputers() async {
        guard let credential = activeCredential else {
            computers = []
            selectedTargetDeviceId = nil
            return
        }
        do {
            let response = try await api.listComputers(ListCloudComputersRequest(
                deviceId: credential.deviceId,
                deviceSecret: credential.value
            ))
            computers = response.computers
            selectedTargetDeviceId = response.cursorTargetDeviceId
            lastError = nil
        } catch is CancellationError {
            return
        } catch {
            lastError = error.localizedDescription
        }
    }

    func selectTarget(deviceId: String?) async {
        guard let credential = activeCredential else { return }
        do {
            let response = try await api.setCursorTarget(SetCursorTargetRequest(
                deviceId: credential.deviceId,
                deviceSecret: credential.value,
                cursorTargetDeviceId: deviceId
            ))
            selectedTargetDeviceId = response.cursorTargetDeviceId
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func queueCursorDelivery(result: ScanResult, deliveryId: String) async -> Bool? {
        guard result.kind == .barcode || result.kind == .text,
              let credential = activeCredential,
              let target = selectedComputer
        else { return nil }

        requestSync()
        if let syncTask { await syncTask.value }
        guard outbox.records.first(where: { $0.id == result.id })?.state == .uploaded else {
            return false
        }
        let request = QueueCursorDeliveryRequest(
            deviceId: credential.deviceId,
            deviceSecret: credential.value,
            deliveryId: deliveryId,
            resultId: result.id.uuidString.lowercased(),
            targetDeviceId: target.deviceId,
            kind: result.kind.rawValue,
            text: result.value,
            format: result.format,
            clientCreatedAt: Date.now.timeIntervalSince1970 * 1_000
        )
        for attempt in 0..<3 {
            do {
                guard credential.deviceId == activeCredential?.deviceId else { return false }
                if attempt > 0 {
                    try await Task.sleep(for: .seconds(Double(attempt) * 0.5))
                    guard credential.deviceId == activeCredential?.deviceId else { return false }
                }
                _ = try await api.queueCursorDelivery(request)
                lastError = nil
                return true
            } catch is CancellationError {
                return false
            } catch {
                if attempt == 2 {
                    lastError = "Capture saved. Computer insertion could not be queued."
                    return false
                }
            }
        }
        return false
    }

    func trackCursorDelivery(deliveryId: String, resultId: UUID) {
        inFlightDeliveries[deliveryId] = InFlightDelivery(
            resultId: resultId,
            giveUpAt: Date.now.addingTimeInterval(Self.deliveryGiveUpInterval)
        )
    }

    func pollCursorDeliveryStatuses() async -> [CursorDeliveryResolution] {
        // Drain buffered resolutions first — before (and regardless of) the
        // credential/network guard — so sign-out/revocation clears pending
        // badges on the next refresh even while signed out.
        var resolutions = drainBufferedResolutions()

        // Give up on deliveries past their deadline (the server TTL is 120s, so
        // 15 min is generous). This also resolves ids a success response omits
        // (unknown/other-device) so they cannot linger forever.
        let now = Date.now
        let expiredIds = Array(inFlightDeliveries.filter({ $0.value.giveUpAt <= now }).keys)
        for deliveryId in expiredIds {
            guard let tracked = inFlightDeliveries.removeValue(forKey: deliveryId) else { continue }
            resolutions.append(CursorDeliveryResolution(
                resultId: tracked.resultId,
                state: .failed,
                errorCode: "expired"
            ))
        }

        // Coalesce overlapping polls (ScannerView's loop + scene-active trigger).
        guard !isPollingDeliveries else { return resolutions }
        guard let credential = activeCredential, !inFlightDeliveries.isEmpty else { return resolutions }

        isPollingDeliveries = true
        defer { isPollingDeliveries = false }

        // Cap the batch at 100 ids (server slices to 100); leftovers poll next round.
        let deliveryIds = Array(inFlightDeliveries.keys.prefix(Self.deliveryStatusBatchLimit))
        do {
            let response = try await api.cursorDeliveryStatus(CursorDeliveryStatusRequest(
                deviceId: credential.deviceId,
                deviceSecret: credential.value,
                deliveryIds: deliveryIds
            ))
            lastError = nil
            for status in response.statuses where status.isTerminal {
                guard let tracked = inFlightDeliveries.removeValue(forKey: status.deliveryId) else { continue }
                resolutions.append(CursorDeliveryResolution(
                    resultId: tracked.resultId,
                    state: status.state == "delivered" ? .sent : .failed,
                    errorCode: status.errorCode
                ))
            }
            return resolutions
        } catch is CancellationError {
            return resolutions
        } catch MobileCloudError.credentialRevoked {
            revokeLocalCredential()
            lastError = MobileCloudError.credentialRevoked.localizedDescription
            return resolutions + drainBufferedResolutions()
        } catch {
            lastError = error.localizedDescription
            return resolutions
        }
    }

    private func drainBufferedResolutions() -> [CursorDeliveryResolution] {
        guard !bufferedDeliveryResolutions.isEmpty else { return [] }
        let drained = bufferedDeliveryResolutions
        bufferedDeliveryResolutions.removeAll()
        return drained
    }

    // Convert cleared in-flight tracking into buffered .saved resolutions so a
    // sign-out/revocation never leaves a result stuck on .sending. The insertion
    // outcome is unknown, so .saved just clears the pending badge (no failure toast).
    private func bufferClearedDeliveryTracking() {
        for tracked in inFlightDeliveries.values {
            bufferedDeliveryResolutions.append(CursorDeliveryResolution(
                resultId: tracked.resultId,
                state: .saved,
                errorCode: nil
            ))
        }
        inFlightDeliveries.removeAll()
    }

    func retainConflictingCaptures() {
        guard let conflict = accountSwitchConflict else { return }
        do {
            try outbox.retain(ids: conflict.recordIds)
            accountSwitchConflict = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func attachConflictingCaptures() {
        guard let conflict = accountSwitchConflict,
              let credential = activeCredential,
              let ownerClerkUserId = credential.clerkUserId
        else { return }
        do {
            try outbox.attach(
                ids: conflict.recordIds,
                ownerClerkUserId: ownerClerkUserId,
                workspaceId: credential.workspaceId
            )
            accountSwitchConflict = nil
            requestSync()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func deleteConflictingCaptures() {
        guard let conflict = accountSwitchConflict else { return }
        do {
            try outbox.remove(ids: conflict.recordIds)
            accountSwitchConflict = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func revokeLocalCredential() {
        try? DeviceCredentialStore.remove()
        credential = nil
        lastBootstrappedClerkUserId = nil
        computers = []
        selectedTargetDeviceId = nil
        bufferClearedDeliveryTracking()
        cancelUploadTasks()
    }

    func requestSync() {
        guard activeCredential != nil else { return }
        if syncTask != nil {
            syncRequestedWhileDraining = true
            return
        }
        syncRequestedWhileDraining = false
        retryTask?.cancel()
        retryTask = nil
        syncTask = Task { [weak self] in
            await self?.drainOutbox()
        }
    }

    private var activeCredential: CloudDeviceCredential? {
        guard let credential,
              let authenticatedClerkUserId,
              credential.clerkUserId == authenticatedClerkUserId
        else { return nil }
        return credential
    }

    private func pauseForSignOut() {
        authenticatedClerkUserId = nil
        lastBootstrappedClerkUserId = nil
        clerkForBootstrap = nil
        cancelUploadTasks()
        computers = []
        selectedTargetDeviceId = nil
        accountSwitchConflict = nil
        bufferClearedDeliveryTracking()
        try? outbox.pauseUploads()
    }

    private func cancelUploadTasks() {
        syncTask?.cancel()
        syncTask = nil
        syncRequestedWhileDraining = false
        retryTask?.cancel()
        retryTask = nil
    }

    private func drainOutbox() async {
        isSyncing = true
        defer {
            isSyncing = false
            syncTask = nil
            if syncRequestedWhileDraining || hasReadyRecordsForActiveCredential {
                syncRequestedWhileDraining = false
                requestSync()
            } else {
                scheduleRetryIfNeeded()
            }
        }
        guard let credential,
              credential.deviceId == activeCredential?.deviceId,
              let ownerClerkUserId = credential.clerkUserId
        else { return }
        let batches = Dictionary(
            grouping: outbox.readyRecords(ownerClerkUserId: ownerClerkUserId),
            by: \.batchId
        )
            .values
            .sorted { ($0.first?.capturedAt ?? .distantPast) < ($1.first?.capturedAt ?? .distantPast) }
        for records in batches {
            guard !Task.isCancelled else { return }
            do {
                for record in records { try outbox.markSyncing(id: record.id) }
                var photoDataByResult: [UUID: Data] = [:]
                for record in records {
                    photoDataByResult[record.id] = try outbox.photoData(for: record)
                }
                _ = try await api.putBatch(batchRequest(
                    for: records,
                    photoDataByResult: photoDataByResult,
                    credential: credential
                ))
                for record in records {
                    guard let photoData = photoDataByResult[record.id] else { continue }
                    let upload = try await api.createPhotoUploadURL(CreatePhotoUploadURLRequest(
                        deviceId: credential.deviceId,
                        deviceSecret: credential.value,
                        batchId: record.batchId,
                        resultId: record.id.uuidString.lowercased(),
                        contentType: record.photoContentType ?? "image/jpeg",
                        byteCount: photoData.count
                    ))
                    try await api.uploadPhoto(photoData, using: upload)
                }
                if let batchId = records.first?.batchId {
                    try await api.markBatchReady(MarkCloudBatchReadyRequest(
                        deviceId: credential.deviceId,
                        deviceSecret: credential.value,
                        batchId: batchId
                    ))
                }
                guard !Task.isCancelled, credential.deviceId == activeCredential?.deviceId else { return }
                for record in records { try outbox.markUploaded(id: record.id) }
                lastError = nil
            } catch is CancellationError {
                return
            } catch MobileCloudError.credentialRevoked {
                revokeLocalCredential()
                lastError = MobileCloudError.credentialRevoked.localizedDescription
                return
            } catch {
                guard !Task.isCancelled else { return }
                for record in records { try? outbox.markFailed(id: record.id) }
                lastError = error.localizedDescription
            }
        }
    }

    private var hasReadyRecordsForActiveCredential: Bool {
        guard let ownerClerkUserId = activeCredential?.clerkUserId else { return false }
        return !outbox.readyRecords(ownerClerkUserId: ownerClerkUserId).isEmpty
    }

    private func scheduleRetryIfNeeded() {
        guard let credential = activeCredential,
              let ownerClerkUserId = credential.clerkUserId,
              let retryAt = outbox.records
                .filter({ $0.ownerClerkUserId == ownerClerkUserId && $0.state == .failed })
                .compactMap(\.nextAttemptAt)
                .min()
        else { return }
        let delay = max(0, retryAt.timeIntervalSinceNow)
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.retryTask = nil
            self?.requestSync()
        }
    }

    private func updateOwnershipConflict() {
        guard let credential = activeCredential,
              let ownerClerkUserId = credential.clerkUserId
        else {
            accountSwitchConflict = nil
            return
        }
        let records = outbox.pendingOwnershipConflicts(for: ownerClerkUserId)
        guard !records.isEmpty else {
            accountSwitchConflict = nil
            return
        }
        let ids = Set(records.map(\.id))
        accountSwitchConflict = CaptureOwnershipConflict(
            currentClerkUserId: ownerClerkUserId,
            recordIds: ids,
            priorOwnerClerkUserIds: Array(Set(records.compactMap(\.ownerClerkUserId))).sorted(),
            exportText: outbox.exportText(for: ids),
            exportPhotoURLs: outbox.exportPhotoURLs(for: ids)
        )
    }

    private func bootstrapResponse(
        bearerToken: String,
        clerkUserId: String
    ) async throws -> BootstrapMobileDeviceResponse {
        let canReuseExistingDevice = credential?.clerkUserId == clerkUserId || credential?.clerkUserId == nil
        let existingDeviceId = canReuseExistingDevice ? credential?.deviceId : nil
        do {
            return try await api.bootstrapDevice(
                BootstrapMobileDeviceRequest(
                    installationId: Self.installationId,
                    label: Self.installationLabel,
                    existingDeviceId: existingDeviceId
                ),
                bearerToken: bearerToken
            )
        } catch MobileCloudError.httpStatus(let status) where status == 500 {
            guard existingDeviceId != nil, credential?.clerkUserId == nil else {
                throw MobileCloudError.httpStatus(status)
            }
            return try await api.bootstrapDevice(
                BootstrapMobileDeviceRequest(
                    installationId: Self.installationId,
                    label: Self.installationLabel,
                    existingDeviceId: nil
                ),
                bearerToken: bearerToken
            )
        }
    }

    private func freshBearerToken(using clerk: Clerk) async throws -> String {
        guard clerk.user != nil,
              let token = try await clerk.auth.getToken(
                  .init(
                      template: AppConfiguration.clerkJWTTemplate,
                      skipCache: true
                  )
              )
        else {
            throw MobileAccessError.signInRequired
        }
        return token
    }

    private func batchRequest(
        for records: [CloudCaptureRecord],
        photoDataByResult: [UUID: Data],
        credential: CloudDeviceCredential
    ) -> PutCloudBatchRequest {
        let createdAt = records.map(\.capturedAt).min() ?? .now
        return PutCloudBatchRequest(
            deviceId: credential.deviceId,
            deviceSecret: credential.value,
            batchId: records.first?.batchId ?? UUID().uuidString.lowercased(),
            clientCreatedAt: createdAt.timeIntervalSince1970 * 1_000,
            results: records.map { record in
                CloudResultInput(
                    resultId: record.idempotencyKey,
                    kind: record.kind,
                    text: record.kind == "photo" ? nil : record.value,
                    format: record.format,
                    contentType: record.photoContentType,
                    byteCount: photoDataByResult[record.id]?.count ?? 0,
                    checksum: nil,
                    clientCreatedAt: record.capturedAt.timeIntervalSince1970 * 1_000
                )
            }
        )
    }

    // Server TTL is 120s; 15 min is a generous client-side give-up window.
    private static let deliveryGiveUpInterval: TimeInterval = 15 * 60
    private static let deliveryStatusBatchLimit = 100

    private static let installationIdKey = "volt.mobile.installation-id.v1"

    private static var installationId: String {
        if let existing = UserDefaults.standard.string(forKey: installationIdKey), !existing.isEmpty {
            return existing
        }
        let value = "ios-install-\(UUID().uuidString.lowercased())"
        UserDefaults.standard.set(value, forKey: installationIdKey)
        return value
    }

    private static var installationLabel: String {
        let name = UIDevice.current.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let model = UIDevice.current.model.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return model.isEmpty ? "iPhone" : model }
        if model.isEmpty || name.localizedCaseInsensitiveContains(model) { return name }
        return "\(name) (\(model))"
    }
}
