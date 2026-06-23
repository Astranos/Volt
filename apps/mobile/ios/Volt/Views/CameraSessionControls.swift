import SwiftUI

struct LiveIdentifierStrip: View {
    let candidates: [LiveTextCandidate]
    let onSend: (LiveTextCandidate) -> Void

    var body: some View {
        let visibleCandidates = deduplicatedCandidates
        if !visibleCandidates.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(visibleCandidates) { candidate in
                        LiveIdentifierChip(candidate: candidate) {
                            onSend(candidate)
                        }
                    }
                }
                .padding(.horizontal, 18)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 2)
            .transition(.opacity)
        }
    }

    private var deduplicatedCandidates: [LiveTextCandidate] {
        var seen = Set<String>()
        return candidates.filter { candidate in
            let key = "\(candidate.kind.rawValue):\(candidate.value.uppercased())"
            guard !seen.contains(key) else { return false }
            seen.insert(key)
            return true
        }
        .prefix(4)
        .map { $0 }
    }
}

struct LiveIdentifierChip: View {
    let candidate: LiveTextCandidate
    let onSend: () -> Void

    var body: some View {
        Button(action: onSend) {
            HStack(spacing: 6) {
                Text(candidate.kind.rawValue)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white.opacity(0.78))
                Text(candidate.value)
                    .font(.caption.monospaced().weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(Color.green, in: Capsule())
            .overlay {
                Capsule().stroke(.white.opacity(0.32), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(candidate.kind.rawValue) \(candidate.value)")
        .accessibilityHint("Sends this detected identifier")
    }
}
