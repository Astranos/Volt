import UIKit

enum CloudPhotoRendition {
    // Keep workspace photos useful for listing zoom while bounding normal R2 objects to 1 MB.
    static let maxLongEdge: CGFloat = 1800
    static let maxByteCount = 1_000_000

    private static let compressionQualities: [CGFloat] = [0.78, 0.72, 0.66, 0.60]
    private static let dimensionScales: [CGFloat] = [1, 0.85, 0.70, 0.55, 0.40, 0.25]

    static func preparedImage(from image: UIImage) -> UIImage {
        resized(image, maxLongEdge: maxLongEdge)
    }

    static func jpegData(for image: UIImage) -> Data? {
        let boundedImage = preparedImage(from: image)
        let boundedSize = pixelSize(of: boundedImage)
        let boundedLongEdge = max(boundedSize.width, boundedSize.height)
        var smallestCandidate: Data?

        for dimensionScale in dimensionScales {
            let candidateImage = resized(
                boundedImage,
                maxLongEdge: boundedLongEdge * dimensionScale
            )

            for quality in compressionQualities {
                guard let data = candidateImage.jpegData(compressionQuality: quality) else { continue }
                if data.count < (smallestCandidate?.count ?? .max) {
                    smallestCandidate = data
                }
                if data.count <= maxByteCount {
                    return data
                }
            }
        }

        return smallestCandidate
    }

    private static func resized(_ image: UIImage, maxLongEdge: CGFloat) -> UIImage {
        let sourceSize = pixelSize(of: image)
        let longEdge = max(sourceSize.width, sourceSize.height)
        guard longEdge > 0, maxLongEdge > 0 else { return image }

        let ratio = min(1, maxLongEdge / longEdge)
        let targetSize = CGSize(
            width: sourceSize.width * ratio,
            height: sourceSize.height * ratio
        )
        guard targetSize != image.size || image.scale != 1 || image.imageOrientation != .up else {
            return image
        }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: targetSize))
        }
    }

    private static func pixelSize(of image: UIImage) -> CGSize {
        if let cgImage = image.cgImage {
            return CGSize(width: CGFloat(cgImage.width), height: CGFloat(cgImage.height))
        }
        return CGSize(
            width: image.size.width * image.scale,
            height: image.size.height * image.scale
        )
    }
}
