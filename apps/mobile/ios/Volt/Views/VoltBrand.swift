import ClerkKitUI
import SwiftUI

enum VoltBrand {
    static let green = Color(red: 52 / 255, green: 199 / 255, blue: 89 / 255)
    static let ink = Color(red: 8 / 255, green: 8 / 255, blue: 8 / 255)

    @MainActor
    static let clerkTheme = ClerkTheme(
        colors: .init(
            primary: green,
            success: green,
            primaryForeground: .white,
            ring: green
        ),
        design: .init(borderRadius: 14)
    )
}

private struct VoltGlassSurfaceModifier: ViewModifier {
    let cornerRadius: CGFloat

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: .rect(cornerRadius: cornerRadius))
        } else {
            content.background(
                .regularMaterial,
                in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            )
        }
    }
}

extension View {
    func voltGlassSurface(cornerRadius: CGFloat) -> some View {
        modifier(VoltGlassSurfaceModifier(cornerRadius: cornerRadius))
    }
}
