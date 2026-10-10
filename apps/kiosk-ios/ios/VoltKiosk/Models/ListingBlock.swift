import Foundation

enum ListingBlock: Codable, Equatable, Sendable {
    case heading(String)
    case paragraph(String)
    case list([String])
    case specifications([Specification])

    struct Specification: Codable, Equatable, Sendable {
        let label: String
        let value: String
    }

    private enum CodingKeys: String, CodingKey { case kind, text, items, rows }
    private enum Kind: String, Codable { case heading, paragraph, list, specifications }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .heading: self = .heading(try container.decode(String.self, forKey: .text))
        case .paragraph: self = .paragraph(try container.decode(String.self, forKey: .text))
        case .list: self = .list(try container.decode([String].self, forKey: .items))
        case .specifications: self = .specifications(try container.decode([Specification].self, forKey: .rows))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .heading(let text):
            try container.encode(Kind.heading, forKey: .kind)
            try container.encode(text, forKey: .text)
        case .paragraph(let text):
            try container.encode(Kind.paragraph, forKey: .kind)
            try container.encode(text, forKey: .text)
        case .list(let items):
            try container.encode(Kind.list, forKey: .kind)
            try container.encode(items, forKey: .items)
        case .specifications(let rows):
            try container.encode(Kind.specifications, forKey: .kind)
            try container.encode(rows, forKey: .rows)
        }
    }
}
