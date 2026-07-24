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
