import SwiftUI
import UIKit

// MARK: - Photos: history strip, full-screen viewer, camera last-photo button

/// A photo as the shared photo views see it. The image loads lazily so lists stay cheap.
struct GalleryPhoto: Identifiable {
    let id: UUID
    let capturedAt: Date
    let status: HistoryCaptureStatus
    /// False when the phone no longer has the bytes (builds ≤ 74 deleted photos after upload).
    var isStored = true
    let image: () -> UIImage?
}

@MainActor
private enum GalleryThumbnailCache {
    static let images = NSCache<NSString, UIImage>()

    static func key(_ id: UUID, _ pixels: CGFloat) -> NSString { "\(id.uuidString)-\(Int(pixels))" as NSString }
}

/// A gallery photo, downsampled off the main thread and cached, filling whatever frame the
/// caller gives it (callers clip). Shows a photo icon, in the caller's font, when the phone no
/// longer has the bytes.
struct GalleryPhotoImage: View {
    let photo: GalleryPhoto
    let maxPixelSize: CGFloat
    @State private var image: UIImage?

    init(photo: GalleryPhoto, maxPixelSize: CGFloat = 240) {
        self.photo = photo
        self.maxPixelSize = maxPixelSize
        // Start from the cache so a re-shown image never flashes empty.
        _image = State(initialValue: GalleryThumbnailCache.images.object(forKey: GalleryThumbnailCache.key(photo.id, maxPixelSize)))
    }

    var body: some View {
        Color.clear
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else if !photo.isStored {
                    Image(systemName: "photo")
                        .foregroundStyle(.tertiary)
                }
            }
            .task(id: photo.id) {
                guard photo.isStored else { return }
                let key = GalleryThumbnailCache.key(photo.id, maxPixelSize)
                if let cached = GalleryThumbnailCache.images.object(forKey: key) {
                    image = cached
                    return
                }
                let prepared = await photo.image()?.byPreparingThumbnail(ofSize: CGSize(width: maxPixelSize, height: maxPixelSize))
                if let prepared { GalleryThumbnailCache.images.setObject(prepared, forKey: key) }
                image = prepared
            }
    }
}

/// A square, downsampled thumbnail with a small badge when the photo hasn't been sent.
struct GalleryThumbnail: View {
    let photo: GalleryPhoto
    var size: CGFloat = 72
    var showsStatus = true

    var body: some View {
        ZStack {
            Color(.tertiarySystemFill)
            GalleryPhotoImage(photo: photo, maxPixelSize: size * 3)
                .font(.system(size: size * 0.32))
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.16, style: .continuous))
        .overlay(alignment: .bottomTrailing) {
            if showsStatus { statusBadge.padding(4) }
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        switch photo.status {
        case .sent:
            EmptyView()
        case .sending:
            ProgressView()
                .controlSize(.mini)
                .padding(3)
                .background(.ultraThinMaterial, in: Circle())
        case .failed:
            Image(systemName: "exclamationmark.circle.fill")
                .font(.caption)
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, .red)
        case .unsent:
            Image(systemName: "icloud.slash.fill")
                .font(.caption2)
                .foregroundStyle(.white)
                .padding(3)
                .background(.black.opacity(0.45), in: Circle())
        }
    }
}

/// A run of photos inside a history session: one row like a capture row, then a strip of
/// thumbnails. Tap opens the full-screen viewer; long-press a thumbnail for Send / Delete.
struct HistoryPhotoStrip: View {
    let title: String
    let photos: [GalleryPhoto]
    var placeholderCount = 0
    let onSend: (GalleryPhoto) -> Void
    let onDelete: (GalleryPhoto) -> Void
    var onDeleteAll: (() -> Void)?
    @State private var viewerStart: ViewerStart?

    private struct ViewerStart: Identifiable { let id: UUID }

    /// Newest first, so the latest shot is visible without scrolling.
    private var ordered: [GalleryPhoto] {
        photos.sorted { $0.capturedAt > $1.capturedAt }
    }

    private var status: HistoryCaptureStatus {
        if photos.contains(where: { $0.status == .failed }) { return .failed }
        if placeholderCount > 0 || photos.contains(where: { $0.status == .sending }) { return .sending }
        if photos.contains(where: { $0.status == .unsent }) { return .unsent }
        return .sent
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                HistoryCaptureIcon(symbol: "photo.on.rectangle.angled", color: .purple)
                VStack(alignment: .leading, spacing: 2) {
                    Text("PHOTOS")
                        .font(.caption2.weight(.semibold))
                        .tracking(0.4)
                        .foregroundStyle(.secondary)
                    Text(title)
                        .font(.body.weight(.medium))
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 4) {
                    if let latest = ordered.first {
                        Text(latest.capturedAt, format: .dateTime.hour().minute())
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    statusIcon
                }
            }
            .contentShape(Rectangle())
            .contextMenu {
                if let onDeleteAll {
                    Button("Delete All Photos", systemImage: "trash", role: .destructive, action: onDeleteAll)
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 8) {
                    ForEach(0..<placeholderCount, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 11.5, style: .continuous)
                            .fill(Color(.tertiarySystemFill))
                            .frame(width: 72, height: 72)
                            .overlay(ProgressView().controlSize(.small))
                    }
                    ForEach(ordered) { photo in
                        Button { viewerStart = ViewerStart(id: photo.id) } label: {
                            GalleryThumbnail(photo: photo)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            if photo.isStored {
                                Button("Send", systemImage: "paperplane") { onSend(photo) }
                                Divider()
                            }
                            Button("Delete", systemImage: "trash", role: .destructive) { onDelete(photo) }
                        }
                        .accessibilityLabel("Photo from \(photo.capturedAt.formatted(date: .omitted, time: .shortened))")
                        .accessibilityHint("Opens the photo. Touch and hold for more actions.")
                    }
                }
                .padding(.leading, 52)
                .padding(.trailing, 12)
            }
            // Run the strip to the container's trailing edge (past the row padding) so a cut-off
            // thumbnail reads as "scroll for more", while the container still clips it.
            .padding(.trailing, -12)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .fullScreenCover(item: $viewerStart) { start in
            PhotoGalleryViewer(photos: ordered, startID: start.id, onSend: onSend, onDelete: onDelete)
        }
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch status {
        case .sent:
            Image(systemName: "checkmark.circle.fill").font(.footnote).foregroundStyle(.green)
        case .sending:
            ProgressView().controlSize(.mini)
        case .failed:
            Image(systemName: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.red)
        case .unsent:
            Image(systemName: "tray").font(.footnote).foregroundStyle(.secondary)
        }
    }
}

/// Full-screen photo viewer: swipe between photos, pinch or double-tap to zoom,
/// and Send / Share / Delete along the bottom.
struct PhotoGalleryViewer: View {
    let photos: [GalleryPhoto]
    let onSend: (GalleryPhoto) -> Void
    let onDelete: (GalleryPhoto) -> Void
    @State private var selection: UUID
    /// Full image of the current photo for Share, loaded when the page changes rather than in `body`.
    @State private var shareImage: UIImage?
    @Environment(\.dismiss) private var dismiss

    init(photos: [GalleryPhoto], startID: UUID, onSend: @escaping (GalleryPhoto) -> Void, onDelete: @escaping (GalleryPhoto) -> Void) {
        self.photos = photos
        self.onSend = onSend
        self.onDelete = onDelete
        _selection = State(initialValue: startID)
    }

    private var currentIndex: Int? { photos.firstIndex { $0.id == selection } }
    private var current: GalleryPhoto? { currentIndex.map { photos[$0] } }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            TabView(selection: $selection) {
                ForEach(photos) { photo in
                    GalleryPage(photo: photo).tag(photo.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
        }
        .overlay(alignment: .top) { topBar }
        .overlay(alignment: .bottom) { bottomBar }
        .preferredColorScheme(.dark)
        .task(id: selection) {
            shareImage = nil
            guard let current, current.isStored else { return }
            shareImage = current.image()
        }
        .onChange(of: photos.map(\.id)) { oldIDs, newIDs in
            guard !newIDs.contains(selection) else { return }
            guard !newIDs.isEmpty else {
                dismiss()
                return
            }
            let previousIndex = oldIDs.firstIndex(of: selection) ?? 0
            selection = newIDs[min(previousIndex, newIDs.count - 1)]
        }
    }

    private var topBar: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.headline)
                    .frame(width: 44, height: 44)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel("Close")
            Spacer()
            if let current, let currentIndex {
                VStack(spacing: 2) {
                    Text("\(currentIndex + 1) of \(photos.count)")
                        .font(.subheadline.weight(.semibold))
                    Text(current.capturedAt, format: .dateTime.hour().minute())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Color.clear.frame(width: 44, height: 44)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    @ViewBuilder
    private var bottomBar: some View {
        if let current {
            HStack {
                if current.isStored {
                    barButton("Send", systemImage: "paperplane") { onSend(current) }
                    Spacer()
                    if let shareImage {
                        ShareLink(item: Image(uiImage: shareImage), preview: SharePreview("Photo", image: Image(uiImage: shareImage))) {
                            barLabel("Share", systemImage: "square.and.arrow.up")
                        }
                    }
                    Spacer()
                }
                barButton("Delete", systemImage: "trash", role: .destructive) { onDelete(current) }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 28)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial, in: Capsule())
            .padding(.horizontal, 24)
            .padding(.bottom, 8)
        }
    }

    private func barButton(_ title: String, systemImage: String, role: ButtonRole? = nil, action: @escaping () -> Void) -> some View {
        Button(role: role, action: action) {
            barLabel(title, systemImage: systemImage)
        }
        .tint(role == .destructive ? .red : .white)
    }

    private func barLabel(_ title: String, systemImage: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: systemImage).font(.title3)
            Text(title).font(.caption2)
        }
        .frame(minWidth: 56, minHeight: 44)
    }
}

private struct GalleryPage: View {
    let photo: GalleryPhoto
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                ZoomableImageView(image: image)
            } else if photo.isStored {
                ProgressView().tint(.white)
            } else {
                ContentUnavailableView(
                    "Not on this iPhone",
                    systemImage: "photo",
                    description: Text("This photo was uploaded before Donut kept copies on the phone. It was already delivered to your workspace.")
                )
                .foregroundStyle(.white)
            }
        }
        .task(id: photo.id) {
            guard photo.isStored else { return }
            image = photo.image()
        }
    }
}

/// UIScrollView-backed zoom so pinch, pan and double-tap behave like Photos. At 1x it does
/// not scroll, so the surrounding pager still gets horizontal swipes.
private struct ZoomableImageView: UIViewRepresentable {
    let image: UIImage

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIScrollView {
        let scrollView = UIScrollView()
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 5
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.showsVerticalScrollIndicator = false
        scrollView.backgroundColor = .clear
        scrollView.delegate = context.coordinator
        scrollView.contentInsetAdjustmentBehavior = .never

        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleAspectFit
        imageView.frame = scrollView.bounds
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scrollView.addSubview(imageView)
        context.coordinator.imageView = imageView

        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleDoubleTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        scrollView.addGestureRecognizer(doubleTap)
        return scrollView
    }

    func updateUIView(_ scrollView: UIScrollView, context: Context) {
        if context.coordinator.imageView?.image !== image {
            context.coordinator.imageView?.image = image
            scrollView.setZoomScale(1, animated: false)
        }
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        @objc func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
            guard let scrollView = gesture.view as? UIScrollView else { return }
            if scrollView.zoomScale > 1 {
                scrollView.setZoomScale(1, animated: true)
            } else {
                let point = gesture.location(in: imageView)
                let size = CGSize(width: scrollView.bounds.width / 2.5, height: scrollView.bounds.height / 2.5)
                scrollView.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
            }
        }
    }
}

/// Bottom-left camera button showing the session's latest photo, like the iOS Camera app.
struct CameraLastPhotoButton: View {
    let photo: GalleryPhoto
    let count: Int
    var rotation: Angle = .zero
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            GalleryThumbnail(photo: photo, size: 52, showsStatus: false)
                .overlay {
                    RoundedRectangle(cornerRadius: 52 * 0.16, style: .continuous)
                        .stroke(.white.opacity(0.9), lineWidth: 2)
                }
                .overlay(alignment: .topTrailing) {
                    if count > 1 {
                        Text("\(count)")
                            .font(.caption2.weight(.bold).monospacedDigit())
                            .foregroundStyle(.black)
                            .padding(.horizontal, 5)
                            .frame(minWidth: 20, minHeight: 20)
                            .background(.white, in: Capsule())
                            .offset(x: 8, y: -8)
                    }
                }
                .rotationEffect(rotation)
                // A new shot replaces the thumbnail with a small pop, as in Camera.
                .id(photo.id)
                .transition(.scale(scale: 0.6).combined(with: .opacity))
        }
        .buttonStyle(.plain)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: photo.id)
        .accessibilityLabel("Session photos, \(count) photo\(count == 1 ? "" : "s")")
        .accessibilityHint("Opens the photos taken in this session")
        .accessibilityIdentifier("camera-last-photo")
    }
}
