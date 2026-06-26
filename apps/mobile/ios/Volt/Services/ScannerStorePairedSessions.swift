import Foundation
import UIKit

@MainActor
extension ScannerStore {
    func removePairedSession(_ pairedSession: PairedScannerSession) {
        pairedSessions.removeAll { $0.id == pairedSession.id }
        PairingSecretStore.delete(pairingId: pairedSession.id)
        persistPairedSessions()
    }

    func forgetVisibleSession(_ session: PairedScannerSession) {
        if canReconnect(to: session) {
            removePairedSession(session)
            return
        }
        recentBrowserSessions.removeAll { $0.id == session.id }
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
        let visibleRecentSessions = recentBrowserSessions.filter { recentSession in
            !pairedSessions.contains { pairedSession in
                isSameVisibleSession(pairedSession, recentSession)
            }
        }
        return (visibleRecentSessions + pairedSessions)
            .sorted { $0.lastConnectedAt > $1.lastConnectedAt }
    }

    func canReconnect(to session: PairedScannerSession) -> Bool {
        pairedSessions.contains { $0.id == session.id }
    }

    func rememberRecentBrowserSession(browserSessionId: String?, displayName: String?, platform: String? = nil) {
        guard let browserSessionId,
              !browserSessionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }
        let fallbackDisplayName = browserSessionId
        let resolvedDisplayName = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayName = resolvedDisplayName?.isEmpty == false ? resolvedDisplayName! : fallbackDisplayName
        let recentSession = PairedScannerSession(
            id: recentSessionId(browserSessionId: browserSessionId, platform: platform),
            browserSessionId: browserSessionId,
            displayName: displayName,
            platform: platform,
            pairedAt: .now,
            lastConnectedAt: .now
        )
        recentBrowserSessions.removeAll { $0.id == recentSession.id }
        recentBrowserSessions.insert(recentSession, at: 0)
        recentBrowserSessions = Array(recentBrowserSessions.prefix(6))
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
            platform: message.peer?.platform,
            signalURL: pairingSession?.signalURL ?? pairingSession?.sourceURL.signalBaseURL,
            pairedAt: pairedSessions.first { $0.id == pairing.pairingId }?.pairedAt ?? .now,
            lastConnectedAt: .now
        )
        pairedSessions.removeAll {
            $0.id == pairedSession.id ||
                (message.peer?.platform == "chrome_extension" &&
                    $0.browserSessionId == pairedSession.browserSessionId &&
                    $0.displayName == pairedSession.displayName &&
                    ($0.platform == nil || $0.platform == "chrome_extension"))
        }
        pairedSessions.insert(pairedSession, at: 0)
        persistPairedSessions()
        Task {
            try? await signaling.registerPairing(pairing, phoneDeviceId: contributorId)
        }
    }

    private func isSameVisibleSession(_ lhs: PairedScannerSession, _ rhs: PairedScannerSession) -> Bool {
        lhs.browserSessionId == rhs.browserSessionId &&
            lhs.displayName == rhs.displayName &&
            (lhs.platform == rhs.platform || lhs.platform == nil || rhs.platform == nil)
    }

    private func recentSessionId(browserSessionId: String, platform: String?) -> String {
        "recent-\(platform ?? "unknown")-\(browserSessionId)"
    }
}
