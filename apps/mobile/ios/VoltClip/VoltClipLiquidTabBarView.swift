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
  private var nativeGlassEffect: Any?
  private var isMounted = false

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
    isMounted = true
    updateCornerRadius()
    updateAppearance()
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
    updateNativeGlassCornerRadius(radius)
  }

  private func updateAppearance() {
    let clampedProgress = max(0, min(1, CGFloat(truncating: progress)))
    let toneValue = tone as String

    if applyNativeLiquidGlass(progress: clampedProgress, tone: toneValue) {
      return
    }

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

  private func isNativeLiquidGlassAvailable() -> Bool {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      guard let glassEffectClass = NSClassFromString("UIGlassEffect") as? NSObject.Type else {
        return false
      }
      return glassEffectClass.responds(to: Selector(("effectWithStyle:")))
    }
    #endif
    return false
  }

  private func applyNativeLiquidGlass(progress: CGFloat, tone: String) -> Bool {
    guard isMounted, isNativeLiquidGlassAvailable() else {
      return false
    }

    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      let effect: UIGlassEffect
      if let existing = nativeGlassEffect as? UIGlassEffect {
        effect = existing
      } else {
        effect = UIGlassEffect(style: .regular)
        nativeGlassEffect = effect
      }

      if tone == "bright" {
        effect.tintColor = UIColor.white.withAlphaComponent(0.12 + (0.12 * progress))
        blurView.overrideUserInterfaceStyle = .light
      } else {
        effect.tintColor = UIColor.black.withAlphaComponent(0.10 + (0.14 * progress))
        blurView.overrideUserInterfaceStyle = .dark
      }
      effect.isInteractive = true
      blurAnimator?.stopAnimation(true)
      blurAnimator = nil
      blurView.effect = effect
      blurView.alpha = 1
      backgroundColor = .clear
      layer.borderWidth = 0
      updateNativeGlassCornerRadius(CGFloat(truncating: cornerRadius))
      return true
    }
    #endif

    return false
  }

  private func updateNativeGlassCornerRadius(_ radius: CGFloat) {
    guard isMounted, isNativeLiquidGlassAvailable() else {
      return
    }

    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      let cornerRadius = UICornerRadius(floatLiteral: radius)
      blurView.cornerConfiguration = .corners(
        topLeftRadius: cornerRadius,
        topRightRadius: cornerRadius,
        bottomLeftRadius: cornerRadius,
        bottomRightRadius: cornerRadius
      )
    }
    #endif
  }
}

@objc(VoltClipLiquidTabBarView)
class VoltClipLiquidTabBarView: UIView, UITabBarDelegate {
  @objc var onModeChange: RCTDirectEventBlock?
  @objc var selectedMode: NSString = "ocr" {
    didSet {
      selectMode(selectedMode as String)
    }
  }

  private let tabBar = UITabBar()
  private let itemImageConfiguration = UIImage.SymbolConfiguration(pointSize: 24, weight: .semibold)
  private lazy var modeItems: [String: UITabBarItem] = [
    "ocr": makeItem(title: "OCR", image: "doc.text.viewfinder", selectedImage: "doc.text.viewfinder"),
    "barcode": makeItem(title: "Scanner", image: "barcode.viewfinder", selectedImage: "barcode.viewfinder"),
    "photo": makeItem(title: "Photos", image: "photo.on.rectangle", selectedImage: "photo.fill.on.rectangle.fill"),
    "dictation": makeItem(title: "Dictation", image: "mic", selectedImage: "mic.fill"),
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
    tabBar.frame = bounds
  }

  private func setup() {
    isUserInteractionEnabled = true
    clipsToBounds = false
    layer.cornerCurve = .continuous
    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOffset = CGSize(width: 0, height: 8)
    layer.shadowOpacity = 0.28
    layer.shadowRadius = 18

    tabBar.delegate = self
    tabBar.items = ["ocr", "barcode", "photo", "dictation"].compactMap { modeItems[$0] }
    tabBar.selectedItem = modeItems["ocr"]
    tabBar.tintColor = .white
    tabBar.unselectedItemTintColor = UIColor.white.withAlphaComponent(0.76)
    tabBar.itemPositioning = .fill
    tabBar.isTranslucent = true
    tabBar.clipsToBounds = false
    tabBar.backgroundColor = .clear
    tabBar.layer.cornerCurve = .continuous
    tabBar.items?.forEach { item in
      item.imageInsets = UIEdgeInsets(top: -3, left: 0, bottom: 3, right: 0)
      item.titlePositionAdjustment = UIOffset(horizontal: 0, vertical: 4)
    }

    let appearance = UITabBarAppearance()
    appearance.configureWithTransparentBackground()
    appearance.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterialDark)
    appearance.backgroundColor = UIColor.black.withAlphaComponent(0.08)
    appearance.shadowColor = .clear
    configureItemAppearance(appearance.stackedLayoutAppearance)
    configureItemAppearance(appearance.inlineLayoutAppearance)
    configureItemAppearance(appearance.compactInlineLayoutAppearance)
    tabBar.standardAppearance = appearance
    tabBar.scrollEdgeAppearance = appearance

    if #available(iOS 26.0, *) {
      tabBar.isTranslucent = true
    }

    addSubview(tabBar)
    selectMode(selectedMode as String)
  }

  private func makeItem(title: String, image: String, selectedImage: String) -> UITabBarItem {
    UITabBarItem(
      title: title,
      image: UIImage(systemName: image)?
        .withConfiguration(itemImageConfiguration)
        .withRenderingMode(.alwaysTemplate),
      selectedImage: UIImage(systemName: selectedImage)?
        .withConfiguration(itemImageConfiguration)
        .withRenderingMode(.alwaysTemplate)
    )
  }

  private func configureItemAppearance(_ itemAppearance: UITabBarItemAppearance) {
    itemAppearance.normal.iconColor = UIColor.white.withAlphaComponent(0.76)
    itemAppearance.normal.titleTextAttributes = [
      .foregroundColor: UIColor.white.withAlphaComponent(0.76),
      .font: UIFont.systemFont(ofSize: 11, weight: .semibold),
    ]
    itemAppearance.selected.iconColor = .white
    itemAppearance.selected.titleTextAttributes = [
      .foregroundColor: UIColor.white,
      .font: UIFont.systemFont(ofSize: 11, weight: .bold),
    ]
  }

  private func selectMode(_ mode: String) {
    guard let item = modeItems[mode], tabBar.selectedItem !== item else {
      return
    }
    tabBar.selectedItem = item
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    guard let mode = modeItems.first(where: { $0.value === item })?.key else {
      return
    }
    selectedMode = mode as NSString
    onModeChange?(["mode": mode])
  }
}
