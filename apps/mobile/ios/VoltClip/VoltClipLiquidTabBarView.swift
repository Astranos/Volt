import UIKit
import React

@objc(VoltClipLiquidGlassView)
class VoltClipLiquidGlassView: UIView {
  @objc var progress: NSNumber = 0 {
    didSet {
      updateAppearance()
    }
  }

  @objc var cornerRadius: NSNumber = 48 {
    didSet {
      updateCornerRadius()
    }
  }

  @objc var tone: NSString = "adaptive" {
    didSet {
      updateAppearance()
    }
  }

  private let blurView = UIVisualEffectView(effect: nil)
  private var blurAnimator: UIViewPropertyAnimator?
  private var blurStyle: UIBlurEffect.Style = .systemUltraThinMaterialDark

  override init(frame: CGRect) {
    super.init(frame: frame)
    setup()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setup()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    blurView.frame = bounds
    updateCornerRadius()
  }

  private func setup() {
    isUserInteractionEnabled = false
    clipsToBounds = true
    layer.cornerCurve = .continuous
    blurView.isUserInteractionEnabled = false
    addSubview(blurView)
    updateAppearance()
  }

  private func updateCornerRadius() {
    let radius = CGFloat(truncating: cornerRadius)
    layer.cornerRadius = radius
    blurView.layer.cornerRadius = radius
    blurView.layer.cornerCurve = .continuous
    blurView.clipsToBounds = true
  }

  private func updateAppearance() {
    let clampedProgress = max(0, min(1, CGFloat(truncating: progress)))
    let toneValue = tone as String
    let baseAlpha: CGFloat
    let openAlpha: CGFloat
    let nextBlurStyle: UIBlurEffect.Style

    if toneValue == "bright" {
      nextBlurStyle = .systemUltraThinMaterialLight
      baseAlpha = 0.22
      openAlpha = 0.46
      backgroundColor = UIColor.white.withAlphaComponent(baseAlpha + ((openAlpha - baseAlpha) * clampedProgress))
    } else {
      nextBlurStyle = toneValue == "dark" ? .systemMaterialDark : .systemUltraThinMaterialDark
      baseAlpha = toneValue == "dark" ? 0.58 : 0.46
      openAlpha = toneValue == "dark" ? 0.82 : 0.68
      backgroundColor = UIColor.black.withAlphaComponent(baseAlpha + ((openAlpha - baseAlpha) * clampedProgress))
    }

    if blurAnimator == nil || blurStyle != nextBlurStyle {
      blurStyle = nextBlurStyle
      blurAnimator?.stopAnimation(true)
      blurView.effect = nil
      blurAnimator = UIViewPropertyAnimator(duration: 1, curve: .linear) { [weak blurView] in
        blurView?.effect = UIBlurEffect(style: nextBlurStyle)
      }
      blurAnimator?.pausesOnCompletion = true
    }

    blurAnimator?.fractionComplete = 0.22 + (0.78 * clampedProgress)
    blurView.alpha = 0.72 + (0.28 * clampedProgress)
    layer.borderWidth = 1
    layer.borderColor = UIColor.white.withAlphaComponent(0.18 + (0.12 * clampedProgress)).cgColor
  }
}

private final class VoltClipModeTabButton: UIControl {
  let mode: String
  private let iconView = UIImageView()
  private let titleLabel = UILabel()
  private let selectedBackground = UIView()

  init(mode: String, title: String, image: UIImage?) {
    self.mode = mode
    super.init(frame: .zero)

    isAccessibilityElement = true
    accessibilityTraits = [.button]
    accessibilityLabel = title
    clipsToBounds = false

    selectedBackground.isUserInteractionEnabled = false
    selectedBackground.backgroundColor = UIColor.white.withAlphaComponent(0.18)
    selectedBackground.layer.cornerCurve = .continuous
    selectedBackground.alpha = 0
    addSubview(selectedBackground)

    iconView.image = image
    iconView.contentMode = .scaleAspectFit
    iconView.tintColor = UIColor.white.withAlphaComponent(0.84)
    addSubview(iconView)

    titleLabel.text = title
    titleLabel.textAlignment = .center
    titleLabel.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
    titleLabel.textColor = UIColor.white.withAlphaComponent(0.84)
    addSubview(titleLabel)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override var isSelected: Bool {
    didSet {
      updateSelection()
    }
  }

  override var isHighlighted: Bool {
    didSet {
      alpha = isHighlighted ? 0.72 : 1
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    selectedBackground.frame = bounds.insetBy(dx: 2, dy: 0)
    selectedBackground.layer.cornerRadius = selectedBackground.bounds.height / 2

    let iconSize: CGFloat = 30
    iconView.frame = CGRect(
      x: (bounds.width - iconSize) / 2,
      y: 7,
      width: iconSize,
      height: iconSize
    )
    titleLabel.frame = CGRect(x: 2, y: 42, width: bounds.width - 4, height: 17)
  }

  private func updateSelection() {
    accessibilityTraits = isSelected ? [.button, .selected] : [.button]
    selectedBackground.alpha = isSelected ? 1 : 0
    iconView.tintColor = isSelected ? .white : UIColor.white.withAlphaComponent(0.76)
    titleLabel.textColor = isSelected ? .white : UIColor.white.withAlphaComponent(0.76)
    titleLabel.font = UIFont.systemFont(ofSize: 12, weight: isSelected ? .bold : .semibold)
  }
}

@objc(VoltClipLiquidTabBarView)
class VoltClipLiquidTabBarView: UIView {
  @objc var onModeChange: RCTDirectEventBlock?
  @objc var selectedMode: NSString = "ocr" {
    didSet {
      selectMode(selectedMode as String)
    }
  }

  private let backgroundView = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
  private let itemImageConfiguration = UIImage.SymbolConfiguration(pointSize: 24, weight: .semibold)
  private let stackView = UIStackView()
  private lazy var modeButtons: [String: VoltClipModeTabButton] = [
    "ocr": makeButton(mode: "ocr", title: "OCR", image: "doc.text.viewfinder"),
    "barcode": makeButton(mode: "barcode", title: "Scanner", image: "barcode.viewfinder"),
    "photo": makeButton(mode: "photo", title: "Photos", image: "photo.on.rectangle"),
    "dictation": makeButton(mode: "dictation", title: "Dictation", image: "mic"),
  ]

  override init(frame: CGRect) {
    super.init(frame: frame)
    setup()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setup()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    backgroundView.frame = bounds.insetBy(dx: 0, dy: 6)
    backgroundView.layer.cornerRadius = backgroundView.bounds.height / 2
    stackView.frame = backgroundView.frame.insetBy(dx: 6, dy: 5)
  }

  private func setup() {
    isUserInteractionEnabled = true
    clipsToBounds = false
    layer.cornerCurve = .continuous
    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOffset = CGSize(width: 0, height: 8)
    layer.shadowOpacity = 0.28
    layer.shadowRadius = 18

    backgroundView.isUserInteractionEnabled = false
    backgroundView.clipsToBounds = true
    backgroundView.layer.cornerCurve = .continuous
    backgroundView.contentView.backgroundColor = UIColor.black.withAlphaComponent(0.24)
    backgroundView.layer.borderWidth = 0

    stackView.axis = .horizontal
    stackView.alignment = .fill
    stackView.distribution = .fillEqually
    stackView.spacing = 4
    ["ocr", "barcode", "photo", "dictation"].compactMap { modeButtons[$0] }.forEach { stackView.addArrangedSubview($0) }

    addSubview(backgroundView)
    addSubview(stackView)
    selectMode(selectedMode as String)
  }

  private func makeButton(mode: String, title: String, image: String) -> VoltClipModeTabButton {
    let button = VoltClipModeTabButton(
      mode: mode,
      title: title,
      image: UIImage(systemName: image)?
        .withConfiguration(itemImageConfiguration)
        .withRenderingMode(.alwaysTemplate)
    )
    button.addTarget(self, action: #selector(didTapModeButton(_:)), for: .touchUpInside)
    return button
  }

  private func selectMode(_ mode: String) {
    modeButtons.forEach { buttonMode, button in
      button.isSelected = buttonMode == mode
    }
  }

  @objc private func didTapModeButton(_ sender: UIControl) {
    guard let button = sender as? VoltClipModeTabButton else {
      return
    }
    let mode = button.mode
    selectedMode = mode as NSString
    onModeChange?(["mode": mode])
  }
}
