import Foundation

struct CloudComputer: Codable, Equatable, Identifiable, Sendable {
    let deviceId: String
    let label: String
    let capabilities: [String]
    let online: Bool

    var id: String { deviceId }
    var supportsCursorInsertion: Bool { capabilities.contains("cursor-insertion") }
}

struct ListCloudComputersResponse: Codable, Sendable {
    let cursorTargetDeviceId: String?
    let computers: [CloudComputer]
}

struct ListCloudComputersPage: Decodable, Sendable {
    let workspaceId: String
    let cursorTargetDeviceId: String?
    let computers: [CloudComputer]
    let continueCursor: String
    let isDone: Bool
}

/// A live page chain. Request identities invalidate callbacks from replaced tails.
struct CloudComputerPageChain {
    struct Request: Equatable, Sendable {
        let id: UUID
        let cursor: String?
    }

    struct Update {
        let cancelled: [UUID]
        let next: Request?
        let response: ListCloudComputersResponse?
    }

    enum PageError: LocalizedError {
        case workspaceChanged
        case repeatedCursor

        var errorDescription: String? {
            switch self {
            case .workspaceChanged: "Computer list belongs to another workspace."
            case .repeatedCursor: "Computer list pagination did not advance."
            }
        }
    }

    private struct Slot {
        let request: Request
        var page: ListCloudComputersPage?
    }

    let workspaceId: String
    private var slots: [Slot] = []

    init(workspaceId: String) { self.workspaceId = workspaceId }

    mutating func start() -> Request {
        let request = Request(id: UUID(), cursor: nil)
        slots = [Slot(request: request)]
        return request
    }

    mutating func stop() { slots = [] }

    mutating func receive(_ page: ListCloudComputersPage, for request: Request) throws -> Update? {
        guard let index = slots.firstIndex(where: { $0.request.id == request.id }) else { return nil }
        guard page.workspaceId == workspaceId else { throw PageError.workspaceChanged }
        slots[index].page = page
        let nextCursor = page.isDone ? nil : page.continueCursor
        var cancelled: [UUID] = []
        var next: Request?
        if nextCursor == nil || slots.dropFirst(index + 1).first?.request.cursor != nextCursor {
            cancelled = slots.dropFirst(index + 1).map { $0.request.id }
            slots.removeSubrange((index + 1)..<slots.count)
            if let nextCursor {
                guard !nextCursor.isEmpty, !slots.contains(where: { $0.request.cursor == nextCursor }) else {
                    throw PageError.repeatedCursor
                }
                let request = Request(id: UUID(), cursor: nextCursor)
                slots.append(Slot(request: request))
                next = request
            }
        }
        return Update(cancelled: cancelled, next: next, response: completeResponse)
    }

    private var completeResponse: ListCloudComputersResponse? {
        guard let first = slots.first?.page, slots.last?.page?.isDone == true,
              slots.allSatisfy({ $0.page != nil }) else { return nil }
        var computers: [CloudComputer] = []
        var offsets: [String: Int] = [:]
        for slot in slots {
            for computer in slot.page?.computers ?? [] {
                if let index = offsets[computer.deviceId] {
                    computers[index] = computer
                } else {
                    offsets[computer.deviceId] = computers.count
                    computers.append(computer)
                }
            }
        }
        return ListCloudComputersResponse(cursorTargetDeviceId: first.cursorTargetDeviceId, computers: computers)
    }
}
