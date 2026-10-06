import SwiftUI

struct KioskCatalogFiltersView: View {
    @Bindable var session: KioskSession
    private let budgets = [0, 5000, 10000, 25000, 50000]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search products, brands, or SKU", text: $session.filters.query)
                    .font(.title3).submitLabel(.search).autocorrectionDisabled()
                if !session.filters.query.isEmpty {
                    Button("Clear search", systemImage: "xmark.circle.fill", action: clearSearch)
                        .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                }
            }
            .padding(.horizontal, 16).frame(minHeight: 56)
            .background(.background, in: RoundedRectangle(cornerRadius: 14))
            ScrollView(.horizontal) {
                HStack(spacing: 10) {
                    categoryButton(nil)
                    ForEach(KioskCategory.allCases) { category in categoryButton(category) }
                }
            }
            .scrollIndicators(.hidden)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 24) { budgetPicker; sortPicker; clearButton }
                VStack(alignment: .leading, spacing: 12) { budgetPicker; sortPicker; clearButton }
            }
        }
        .onChange(of: session.filters) { _, _ in session.recordActivity() }
    }

    private var budgetPicker: some View {
        HStack {
            Text("Budget").bold()
            Picker("Budget", selection: $session.filters.budgetCents) {
                ForEach(budgets, id: \.self) { cents in
                    Text(cents == 0 ? "Any price" : "Up to \(KioskProduct.money(cents))").tag(cents)
                }
            }
            .pickerStyle(.menu).frame(minHeight: 44)
        }
    }

    private var sortPicker: some View {
        HStack {
            Text("Sort").bold()
            Picker("Sort products", selection: $session.filters.sort) {
                ForEach(CatalogFilters.Sort.allCases) { sort in Text(sort.rawValue).tag(sort) }
            }
            .pickerStyle(.menu).frame(minHeight: 44)
        }
    }

    private var clearButton: some View {
        Button("Clear filters", systemImage: "line.3.horizontal.decrease.circle", action: clearFilters)
            .frame(minHeight: 44)
    }

    private func categoryButton(_ category: KioskCategory?) -> some View {
        let selected = session.filters.category == category
        return Button {
            session.filters.category = category
            session.recordActivity()
        } label: {
            Label(category?.rawValue ?? "All items", systemImage: category?.symbol ?? "square.grid.2x2")
                .font(.headline).padding(.horizontal, 18).frame(minHeight: 48)
                .foregroundStyle(selected ? .white : KioskCustomerStyle.green)
                .background(selected ? KioskCustomerStyle.green : .white, in: Capsule())
                .overlay(Capsule().strokeBorder(KioskCustomerStyle.green.opacity(selected ? 1 : 0.2)))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private func clearSearch() { session.filters.query = ""; session.recordActivity() }
    private func clearFilters() { session.filters = CatalogFilters(); session.recordActivity() }
}
