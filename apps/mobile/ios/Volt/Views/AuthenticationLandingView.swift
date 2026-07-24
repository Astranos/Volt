import ClerkKitUI
import SwiftUI

struct AuthenticationLandingView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isAuthPresented = false
    @State private var didAppear = false

    var body: some View {
        ZStack {
            background

            VStack(spacing: 0) {
                Spacer(minLength: 32)

                brandHero
                    .padding(.horizontal, 32)
                    .opacity(didAppear ? 1 : 0)
                    .offset(y: didAppear ? 0 : 18)

                Spacer(minLength: 32)

                signInActions
                    .padding(.horizontal, 24)
                    .padding(.bottom, 28)
                    .opacity(didAppear ? 1 : 0)
                    .offset(y: didAppear ? 0 : 12)
            }
        }
        .sheet(isPresented: $isAuthPresented) {
            AuthView()
                .environment(\.clerkTheme, VoltBrand.clerkTheme)
                .clerkAppIcon(Image("VoltLogo"))
                .clerkAppIcon(maxHeight: 56)
                .presentationDragIndicator(.visible)
                .presentationBackground(VoltBrand.clerkTheme.colors.background)
        }
        .onAppear {
            guard !didAppear else { return }
            if reduceMotion {
                didAppear = true
            } else {
                withAnimation(.spring(response: 0.55, dampingFraction: 0.86)) {
                    didAppear = true
                }
            }
        }
        .accessibilityIdentifier("volt-main-authentication")
    }

    private var background: some View {
        ZStack {
            Color(.systemBackground)

            LinearGradient(
                colors: [
                    VoltBrand.green.opacity(0.18),
                    VoltBrand.green.opacity(0.05),
                    .clear,
                ],
                startPoint: .top,
                endPoint: .center
            )

            Circle()
                .fill(VoltBrand.green.opacity(0.12))
                .frame(width: 280, height: 280)
                .blur(radius: 40)
                .offset(y: -120)
        }
        .ignoresSafeArea()
    }

    private var brandHero: some View {
        VStack(spacing: 22) {
            Image("VoltLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 84, height: 84)
                .accessibilityHidden(true)
                .scaleEffect(didAppear ? 1 : 0.92)

            VStack(spacing: 12) {
                Text("Volt")
                    .font(.largeTitle.bold())
                    .foregroundStyle(VoltBrand.ink)
                    .accessibilityAddTraits(.isHeader)

                Text("Capture barcodes, text, and photos on your iPhone, then sync them to your workspace.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var signInActions: some View {
        VStack(spacing: 14) {
            Button("Sign in") {
                isAuthPresented = true
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .controlSize(.large)
            .buttonStyle(.glassProminent)
            .tint(VoltBrand.green)
            .accessibilityIdentifier("volt-sign-in-button")

            Text("Use the same account as Volt on Chrome.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }
}

#Preview {
    AuthenticationLandingView()
}
