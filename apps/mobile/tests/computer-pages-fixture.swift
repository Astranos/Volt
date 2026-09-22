import Foundation

@main
struct ComputerPagesFixture {
    static func computer(_ id: String, online: Bool = true) -> CloudComputer {
        CloudComputer(deviceId: id, label: id, capabilities: ["cursor-insertion"], online: online)
    }

    static func page(_ computers: [CloudComputer], cursor: String? = nil,
                     workspace: String = "alice", target: String? = "computer-149") -> ListCloudComputersPage {
        ListCloudComputersPage(workspaceId: workspace, cursorTargetDeviceId: target,
                               computers: computers, continueCursor: cursor ?? "done", isDone: cursor == nil)
    }

    static func main() throws {
        var chain = CloudComputerPageChain(workspaceId: "alice")
        let first = chain.start()
        let firstRows = (0..<100).map { computer("computer-\($0)") }
        let tailRows = (100..<150).map { computer("computer-\($0)") }
        let initial = try chain.receive(page(firstRows, cursor: "tail"), for: first)!
        precondition(initial.response == nil, "never publish an incomplete first page")
        let tail = initial.next!
        let complete = try chain.receive(page(tailRows), for: tail)!
        precondition(complete.response?.computers.count == 150)
        precondition(complete.response?.cursorTargetDeviceId == "computer-149")

        var updatedRows = tailRows
        updatedRows[49] = computer("computer-149", online: false)
        let update = try chain.receive(page(updatedRows), for: tail)!
        precondition(update.response?.computers.last?.online == false, "later pages must stay reactive")

        let shifted = try chain.receive(page([computer("new")] + Array(firstRows.dropLast()), cursor: "shifted"), for: first)!
        precondition(shifted.cancelled == [tail.id])
        precondition(shifted.response == nil)
        let obsolete = try chain.receive(page([computer("stale")]), for: tail)
        precondition(obsolete == nil, "replaced subscription callbacks must not publish")
        let shiftedTail = shifted.next!
        let joined = try chain.receive(page([firstRows.last!] + tailRows), for: shiftedTail)!
        precondition(joined.response?.computers.count == 151)
        precondition(Set(joined.response!.computers.map(\.id)).count == 151)

        let shortened = try chain.receive(page([computer("only")], target: nil), for: first)!
        precondition(shortened.cancelled == [shiftedTail.id])
        precondition(shortened.response?.computers.map(\.id) == ["only"])
        precondition(shortened.response?.cursorTargetDeviceId == nil)

        do {
            _ = try chain.receive(page([], workspace: "bob"), for: first)
            preconditionFailure("foreign workspace page accepted")
        } catch CloudComputerPageChain.PageError.workspaceChanged {}

        chain.stop()
        let stopped = try chain.receive(page([computer("late")]), for: first)
        precondition(stopped == nil, "sign-out invalidates every old request")
        let restarted = chain.start()
        let empty = try chain.receive(page([], target: nil), for: restarted)!
        precondition(empty.response?.computers.isEmpty == true, "empty is a complete non-null response")
        let oldRoot = try chain.receive(page([computer("old-account")]), for: first)
        precondition(oldRoot == nil)

        let pending = try chain.receive(page([], cursor: "repeat"), for: restarted)!
        do {
            _ = try chain.receive(page([], cursor: "repeat"), for: pending.next!)
            preconditionFailure("repeated cursor accepted")
        } catch CloudComputerPageChain.PageError.repeatedCursor {}
        print("computer page fixtures passed")
    }
}
