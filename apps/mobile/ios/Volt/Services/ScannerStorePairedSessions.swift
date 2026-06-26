import Foundation
import UIKit

@MainActor
extension ScannerStore {
    func removePairedSession(_ pairedSession: PairedScannerSession) {
        pairedSessions.removeAll { $0.id == pairedSession.id }
        PairingSecretStore.delete(pairingId: pairedSession.id)
        persistPairedSessions()
    }

    func pruneExpiredPairedSessions(now: Date = .now) {
        _ = now
    }

    func savedSessionLabel(sessionId: String?) -> String? {
        pairedSessions.first { pairedSession in
            pairedSession.browserSessionId == sessionId
        }?.displayName
    }

    var visiblePairingSessions: [PairedScannerSession] {
        guard let recentBrowserSession else { return pairedSessions }
        guard !pairedSessions.contains(where: { $0.browserSessionId == recentBrowserSession.browserSessionId }) else {
            return pairedSessions
        }
        return [recentBrowserSession] + pairedSessions
    }

    func canReconnect(to session: PairedScannerSession) -> Bool {
        pairedSessions.contains { $0.id == session.id }
    }

    func rememberRecentBrowserSession(browserSessionId: String?, displayName: String?) {
        guard let browserSessionId,
              !browserSessionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }
        let fallbackDisplayName = browserSessionId
        let resolvedDisplayName = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayName = resolvedDisplayName?.isEmpty == false ? resolvedDisplayName! : fallbackDisplayName
        recentBrowserSession = PairedScannerSession(
            id: "recent-\(browserSessionId)",
            browserSessionId: browserSessionId,
            displayName: displayName,
            pairedAt: .now,
            lastConnectedAt: .now
        )
    }

    func loadPairedSessions() {
        guard let data = UserDefaults.standard.data(forKey: Self.pairedSessionsStorageKey),
              let decoded = try? JSONDecoder().decode([PairedScannerSession].self, from: data)
        else {
            pairedSessions = []
            return
        }
        pairedSessions = decoded
            .sorted { $0.lastConnectedAt > $1.lastConnectedAt }
    }

    func persistPairedSessions() {
        guard let data = try? JSONEncoder().encode(pairedSessions) else { return }
        UserDefaults.standard.set(data, forKey: Self.pairedSessionsStorageKey)
    }

    func saveCurrentPairingSession(message: ScannerProtocol.SessionReady) {
        guard let pairing = message.pairing else { return }
        let displayName = peerTarget?.sessionLabel ?? peerTarget?.tabTitle ?? pairing.displayName ?? pairing.browserSessionId
        PairingSecretStore.save(pairing.pairingSecret, pairingId: pairing.pairingId)
        let pairedSession = PairedScannerSession(
            id: pairing.pairingId,
            browserSessionId: pairing.browserSessionId,
            displayName: displayName,
            pairedAt: pairedSessions.first { $0.id == pairing.pairingId }?.pairedAt ?? .now,
            lastConnectedAt: .now
        )
        pairedSessions.removeAll { $0.id == pairedSession.id || $0.browserSessionId == pairedSession.browserSessionId }
        pairedSessions.insert(pairedSession, at: 0)
        persistPairedSessions()
        Task {
            try? await signaling.registerPairing(pairing, phoneDeviceId: contributorId)
        }
    }
}
