import React
import UIKit
import VisionKit

@objc(LiveTextImageViewManager)
class LiveTextImageViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func view() -> UIView! {
    LiveTextImageView()
  }
}

@objc(LiveTextImageView)
class LiveTextImageView: UIView {
  private let imageView = UIImageView()
  private var analysisTask: Task<Void, Never>?
  private var analyzer: Any?
  private var interaction: Any?

  @objc var imageUri: NSString = "" {
    didSet {
      loadImage()
    }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    setup()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setup()
  }

  deinit {
    analysisTask?.cancel()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    imageView.frame = bounds
  }

  private func setup() {
    clipsToBounds = true
    imageView.contentMode = .scaleAspectFit
    imageView.isUserInteractionEnabled = true
    addSubview(imageView)

    if #available(iOS 16.0, *) {
      let liveTextInteraction = ImageAnalysisInteraction()
      liveTextInteraction.preferredInteractionTypes = .textSelection
      imageView.addInteraction(liveTextInteraction)
      interaction = liveTextInteraction
      analyzer = ImageAnalyzer()
    }
  }

  private func loadImage() {
    analysisTask?.cancel()

    guard let image = image(from: imageUri as String) else {
      imageView.image = nil
      if #available(iOS 16.0, *) {
        (interaction as? ImageAnalysisInteraction)?.analysis = nil
      }
      return
    }

    imageView.image = image
    analyze(image)
  }

  private func image(from uri: String) -> UIImage? {
    guard !uri.isEmpty else {
      return nil
    }

    let url = URL(string: uri) ?? URL(fileURLWithPath: uri)
    guard url.isFileURL else {
      return nil
    }

    return UIImage(contentsOfFile: url.path)
  }

  private func analyze(_ image: UIImage) {
    guard #available(iOS 16.0, *) else {
      return
    }
    guard let analyzer = analyzer as? ImageAnalyzer, let interaction = interaction as? ImageAnalysisInteraction else {
      return
    }

    analysisTask = Task { [weak self] in
      guard let self else {
        return
      }

      do {
        let configuration = ImageAnalyzer.Configuration([.text])
        let analysis = try await analyzer.analyze(image, configuration: configuration)
        await MainActor.run {
          guard !Task.isCancelled else {
            return
          }
          interaction.analysis = analysis
          interaction.preferredInteractionTypes = .textSelection
        }
      } catch {
        await MainActor.run {
          interaction.analysis = nil
        }
      }
    }
  }
}
