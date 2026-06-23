import PhotosUI
import SwiftUI

enum ScannerTabLayout {
    static let stackSpacing: CGFloat = 18
    static let contentPadding: CGFloat = 20
    static let topPadding: CGFloat = 8
    static let bottomAccessoryContentPadding: CGFloat = 84
    static let primaryActionCornerRadius: CGFloat = 22
    static let disabledPrimaryActionOpacity = 0.68

    static var background: Color {
        Color(.systemGroupedBackground)
    }

    static func primaryActionBackground(isEnabled: Bool) -> Color {
        isEnabled ? .green : .gray
    }
}

struct ScannerConnectionSummary: Equatable {
    let isConnected: Bool
    let isBusy: Bool
    let title: String
    let statusText: String
}

struct ScannerChromeSectionHeader<TrailingAccessory: View>: View {
    let title: String
    let connection: ScannerConnectionSummary
    let onConnectionControlTapped: () -> Void
    @ViewBuilder let trailingAccessory: () -> TrailingAccessory

    init(
        title: String,
        connection: ScannerConnectionSummary,
        onConnectionControlTapped: @escaping () -> Void,
        @ViewBuilder trailingAccessory: @escaping () -> TrailingAccessory
    ) {
        self.title = title
        self.connection = connection
        self.onConnectionControlTapped = onConnectionControlTapped
        self.trailingAccessory = trailingAccessory
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(title)
                .font(.largeTitle.bold())
                .lineLimit(1)
                .minimumScaleFactor(0.82)
                .frame(maxWidth: .infinity, alignment: .leading)

            trailingAccessory()

            connectionControl
        }
        .accessibilityElement(children: .contain)
    }

    private var connectionControl: some View {
        Button(action: onConnectionControlTapped) {
            HStack(spacing: 8) {
                if connection.isBusy {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.primary)
                } else {
                    Image(systemName: connection.isConnected ? "checkmark.circle.fill" : "desktopcomputer")
                        .font(.subheadline.weight(.semibold))
                }

                Text(connection.title)
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.76)
            }
            .foregroundStyle(connectionColor)
            .padding(.horizontal, 18)
            .frame(minHeight: 44)
            .background(.regularMaterial, in: Capsule())
        }
        .accessibilityLabel(connection.isConnected ? "Connected. Open sessions." : "Connect. Open sessions.")
        .accessibilityHint(connection.statusText)
    }

    private var connectionColor: Color {
        if connection.isConnected {
            return .green
        }
        return connection.isBusy ? .orange : .secondary
    }
}

extension ScannerChromeSectionHeader where TrailingAccessory == EmptyView {
    init(
        title: String,
        connection: ScannerConnectionSummary,
        onConnectionControlTapped: @escaping () -> Void
    ) {
        self.init(title: title, connection: connection, onConnectionControlTapped: onConnectionControlTapped) {
            EmptyView()
        }
    }
}

struct ScannerBottomActionAccessory: View {
    let title: String
    let systemImage: String
    let isEnabled: Bool
    let statusText: String
    let disabledHint: String
    let action: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text(statusText)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)

            Button(action: action) {
                Label(title, systemImage: systemImage)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(
                        ScannerTabLayout.primaryActionBackground(isEnabled: isEnabled),
                        in: RoundedRectangle(cornerRadius: ScannerTabLayout.primaryActionCornerRadius, style: .continuous)
                    )
                    .opacity(isEnabled ? 1 : ScannerTabLayout.disabledPrimaryActionOpacity)
            }
            .buttonStyle(.plain)
            .disabled(!isEnabled)
            .accessibilityHint(isEnabled ? "" : disabledHint)
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(.bar)
    }
}

struct ScannerPhotoPickerAccessory: View {
    @Binding var selectedItems: [PhotosPickerItem]
    let isConnected: Bool
    let isPreparing: Bool
    let statusText: String
    var showsError = false
    let disabledHint: String

    var body: some View {
        VStack(spacing: 10) {
            Text(statusText)
                .font(.footnote)
                .foregroundStyle(showsError ? .red : .secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)

            PhotosPicker(
                selection: $selectedItems,
                maxSelectionCount: 30,
                matching: .images
            ) {
                Label(isPreparing ? "Preparing Uploads" : "Choose Photos", systemImage: isPreparing ? "hourglass" : "photo.on.rectangle.angled")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(
                        ScannerTabLayout.primaryActionBackground(isEnabled: isConnected && !isPreparing),
                        in: RoundedRectangle(cornerRadius: ScannerTabLayout.primaryActionCornerRadius, style: .continuous)
                    )
                    .opacity((isConnected && !isPreparing) ? 1 : ScannerTabLayout.disabledPrimaryActionOpacity)
            }
            .buttonStyle(.plain)
            .disabled(!isConnected || isPreparing)
            .accessibilityHint(isConnected && !isPreparing ? "Opens the photo picker." : disabledHint)
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(.bar)
    }
}
