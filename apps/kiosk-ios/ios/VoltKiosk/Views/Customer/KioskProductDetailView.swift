import SwiftUI

struct KioskProductDetailView: View {
    let product: KioskProduct
    let session: KioskSession
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var currentProduct: KioskProduct { session.latestProduct(for: product) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 24) {
                            KioskProductGallery(images: currentProduct.images, title: currentProduct.title, session: session)
                                .id(product.id)
                                .frame(minWidth: dynamicTypeSize.isAccessibilitySize ? 500 : 438, maxWidth: .infinity)
                            KioskProductSummary(product: currentProduct, session: session)
                                .frame(minWidth: dynamicTypeSize.isAccessibilitySize ? 500 : 340, maxWidth: .infinity)
                        }
                        VStack(alignment: .leading, spacing: 20) {
                            KioskProductGallery(images: currentProduct.images, title: currentProduct.title, session: session)
                                .id(product.id)
                            KioskProductSummary(product: currentProduct, session: session)
                        }
                    }
                    Divider()
                    KioskListingDetailsView(details: currentProduct.details, description: currentProduct.description)
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 20)
                .frame(maxWidth: 1200, alignment: .leading)
                .frame(maxWidth: .infinity)
                .id("product-detail-top")
            }
            .onChange(of: product.id) { _, _ in proxy.scrollTo("product-detail-top", anchor: .top) }
        }
        .simultaneousGesture(DragGesture(minimumDistance: 10).onChanged { _ in session.recordActivity() })
        .background(KioskCustomerStyle.background)
        .overlay(alignment: .topTrailing) {
            Button("Close", systemImage: "xmark", action: close)
                .labelStyle(.iconOnly)
                .font(.title3)
                .frame(width: 44, height: 44)
                .background(.regularMaterial, in: Circle())
                .padding(8)
        }
        .safeAreaInset(edge: .bottom) {
            if let seconds = session.remainingIdleSeconds {
                KioskIdleNotice(seconds: seconds, keepBrowsing: session.recordActivity)
            }
        }
        .tint(KioskCustomerStyle.green)
        .onAppear(perform: session.recordActivity)
        .onChange(of: session.resetID) { _, _ in session.selectedProduct = nil }
    }

    private func close() { session.recordActivity(); session.selectedProduct = nil }
}
