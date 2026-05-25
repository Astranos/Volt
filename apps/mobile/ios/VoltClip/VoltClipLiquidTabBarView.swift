import UIKit
import React

@objc(VoltClipLiquidTabBarView)
class VoltClipLiquidTabBarView: UIView, UITabBarDelegate {
  @objc var onModeChange: RCTDirectEventBlock?
  @objc var selectedMode: NSString = "ocr" {
    didSet {
      selectMode(selectedMode as String)
    }
  }

  private let backgroundView = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
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
    backgroundView.frame = bounds.insetBy(dx: 0, dy: 8)
    backgroundView.layer.cornerRadius = backgroundView.bounds.height / 2
    tabBar.frame = bounds.insetBy(dx: 0, dy: -2)
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
    backgroundView.contentView.backgroundColor = UIColor.black.withAlphaComponent(0.36)
    backgroundView.layer.borderWidth = 1
    backgroundView.layer.borderColor = UIColor.white.withAlphaComponent(0.2).cgColor

    tabBar.delegate = self
    tabBar.items = ["ocr", "barcode", "photo", "dictation"].compactMap { modeItems[$0] }
    tabBar.items?.forEach { item in
      item.imageInsets = UIEdgeInsets(top: -4, left: 0, bottom: 4, right: 0)
      item.titlePositionAdjustment = UIOffset(horizontal: 0, vertical: 5)
    }
    tabBar.selectedItem = modeItems["ocr"]
    tabBar.tintColor = .white
    tabBar.unselectedItemTintColor = UIColor.white.withAlphaComponent(0.92)
    tabBar.itemPositioning = .fill
    tabBar.isTranslucent = true
    tabBar.clipsToBounds = false
    tabBar.backgroundColor = .clear
    tabBar.layer.cornerCurve = .continuous

    let appearance = UITabBarAppearance()
    appearance.configureWithTransparentBackground()
    appearance.backgroundEffect = nil
    appearance.backgroundColor = .clear
    appearance.shadowColor = .clear
    configureItemAppearance(appearance.stackedLayoutAppearance)
    configureItemAppearance(appearance.inlineLayoutAppearance)
    configureItemAppearance(appearance.compactInlineLayoutAppearance)
    tabBar.standardAppearance = appearance
    tabBar.scrollEdgeAppearance = appearance

    addSubview(backgroundView)
    addSubview(tabBar)
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
    itemAppearance.normal.iconColor = UIColor.white.withAlphaComponent(0.92)
    itemAppearance.normal.titleTextAttributes = [
      .foregroundColor: UIColor.white.withAlphaComponent(0.92),
      .font: UIFont.systemFont(ofSize: 12, weight: .semibold),
    ]
    itemAppearance.selected.iconColor = .white
    itemAppearance.selected.titleTextAttributes = [
      .foregroundColor: UIColor.white,
      .font: UIFont.systemFont(ofSize: 12, weight: .bold),
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
