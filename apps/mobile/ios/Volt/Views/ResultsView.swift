import PhotosUI
import SwiftUI

struct UploadView: View {
    @Environment(ScannerStore.self) private var store
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var isPreparingUploads = false
    @State private var uploadError: String?

    private var recentPhotoResults: [ScanResult] {
        store.results.filter { $0.kind == .photo }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    uploadHeader
                    uploadButton
                    statusPanel
                    recentUploads
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Upload")
            .onChange(of: selectedItems) { _, newItems in
                guard !newItems.isEmpty else { return }
                Task {
                    await uploadSelectedItems(newItems)
                    selectedItems = []
                }
            }
        }
    }

    private var uploadHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Circle()
                    .fill(store.connectionStatus.isConnected ? .green : .orange)
                    .frame(width: 9, height: 9)
                Text(store.connectionStatus.isConnected ? "Paired to Chrome" : "Not paired")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            Text("Upload photos")
                .font(.largeTitle.weight(.bold))

            Text(store.connectionStatus.isConnected ? "Choose camera roll photos to send to the connected Chrome sidebar as one batch." : "Pair with Chrome before uploading camera roll photos.")
                .font(.body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var uploadButton: some View {
        let isConnected = store.connectionStatus.isConnected
        let isPreparing = isPreparingUploads

        return PhotosPicker(
            selection: $selectedItems,
            maxSelectionCount: 30,
            matching: .images
        ) {
            HStack(spacing: 14) {
                Image(systemName: isPreparing ? "hourglass" : "photo.on.rectangle.angled")
                    .font(.system(size: 28, weight: .semibold))
                    .frame(width: 54, height: 54)
                    .background(.white.opacity(0.18), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(isPreparing ? "Preparing uploads" : "Choose Photos")
                        .font(.title3.weight(.bold))
                    Text("Photos are grouped into one Chrome batch.")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.78))
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.headline.weight(.semibold))
            }
            .foregroundStyle(.white)
            .padding(18)
            .frame(maxWidth: .infinity)
            .background(isConnected ? .green : .gray, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .opacity(isPreparing ? 0.68 : 1)
        }
        .buttonStyle(.plain)
        .disabled(!isConnected || isPreparing)
    }

    private var statusPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(store.statusText, systemImage: store.connectionStatus.isConnected ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                .font(.headline)
                .foregroundStyle(store.connectionStatus.isConnected ? .green : .orange)

            Text(uploadError ?? store.targetHint)
                .font(.subheadline)
                .foregroundStyle(uploadError == nil ? Color.secondary : Color.red)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var recentUploads: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Recent Uploads")
                    .font(.headline)
                Spacer()
                Text("\(recentPhotoResults.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if recentPhotoResults.isEmpty {
                ContentUnavailableView(
                    "No Uploads Yet",
                    systemImage: "photo.badge.plus",
                    description: Text("Camera roll uploads will appear here after they are sent.")
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 34)
                .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                VStack(spacing: 10) {
                    ForEach(recentPhotoResults) { result in
                        CapturedResultRow(
                            result: result,
                            onDelete: {
                                store.removeResult(id: result.id)
                            }
                        )
                        .padding(14)
                        .background(.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                }
            }
        }
    }

    private func uploadSelectedItems(_ items: [PhotosPickerItem]) async {
        isPreparingUploads = true
        uploadError = nil
        defer { isPreparingUploads = false }

        var images: [UIImage] = []
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data)
            else {
                continue
            }
            images.append(image)
        }

        guard !images.isEmpty else {
            uploadError = "Could not read any selected photos."
            return
        }

        await store.uploadPhotos(images)
    }
}
