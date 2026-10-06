import SwiftUI

struct KioskProductDetailView: View {
    let product: KioskProduct
    let session: KioskSession
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var currentProduct: KioskProduct { session.latestProduct(for: product) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 24) {
                            KioskProductGallery(images: currentProduct.images, title: currentProduct.title, session: session)
                                .frame(minWidth: dynamicTypeSize.isAccessibilitySize ? 500 : 438, maxWidth: .infinity)
                            KioskProductSummary(product: currentProduct, session: session)
                                .frame(minWidth: dynamicTypeSize.isAccessibilitySize ? 500 : 340, maxWidth: .infinity)
                        }
                        VStack(alignment: .leading, spacing: 20) {
                            KioskProductGallery(images: currentProduct.images, title: currentProduct.title, session: session)
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
            }
            .simultaneousGesture(DragGesture(minimumDistance: 10).onChanged { _ in session.recordActivity() })
            .background(KioskCustomerStyle.background)
            .navigationTitle("Item details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close", systemImage: "xmark", action: close).frame(minHeight: 44)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let seconds = session.remainingIdleSeconds {
                KioskIdleNotice(seconds: seconds, keepBrowsing: session.recordActivity)
            }
        }
        .tint(KioskCustomerStyle.green)
        .onAppear(perform: session.recordActivity)
        .onChange(of: session.resetID) { _, _ in dismiss() }
    }

    private func close() { session.recordActivity(); dismiss() }
}
