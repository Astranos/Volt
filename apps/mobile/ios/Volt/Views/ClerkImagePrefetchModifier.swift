import ClerkKitUI
import SwiftUI

struct ClerkImagePrefetchModifier: ViewModifier {
    let isEnabled: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if isEnabled {
            content.prefetchClerkImages()
        } else {
            content
        }
    }
}
