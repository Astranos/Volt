import SwiftUI

struct BarcodeDetectionReticle: View {
    let bounds: CGRect
    let format: String?

    var body: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(.green, lineWidth: 3)
            .shadow(color: .black.opacity(0.42), radius: 3, y: 1)
            .frame(width: max(42, bounds.width), height: max(42, bounds.height))
            .position(x: bounds.midX, y: bounds.midY)
            .transition(.opacity.combined(with: .scale(scale: 0.96)))
            .animation(.easeOut(duration: 0.12), value: bounds)
            .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        guard let format else { return "Code" }
        return format.localizedCaseInsensitiveContains("qr") ? "QR found" : "Code found"
    }
}
