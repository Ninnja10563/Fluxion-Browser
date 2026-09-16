import AppKit
import CoreGraphics
import Foundation

struct Point: Codable { let x: Double; let y: Double }
struct Request: Codable { let points: [Point] }
struct SavedPointer: Codable { let pid: Int32; let app: String; let original: Point; let last: Point }
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw NSError(domain: "FluxionFramePointer", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}
func current() throws -> Point {
    guard let event = CGEvent(source: nil) else { throw NSError(domain: "FluxionFramePointer", code: 2) }
    return Point(x: event.location.x, y: event.location.y)
}
func valid(_ point: Point) -> Bool {
    point.x.isFinite && point.y.isFinite && CGDisplayBounds(CGMainDisplayID()).contains(CGPoint(x: point.x, y: point.y))
}
func post(_ point: Point) throws {
    try require(valid(point), "Pointer coordinate is outside the main display")
    guard let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                              mouseCursorPosition: CGPoint(x: point.x, y: point.y), mouseButton: .left) else {
        throw NSError(domain: "FluxionFramePointer", code: 3)
    }
    event.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.04)
}
do {
    let args = CommandLine.arguments
    try require(args.count == 6, "Expected operation, owned PID, application, request and saved-state paths")
    guard let pid = Int32(args[2]), pid > 0 else { throw NSError(domain: "FluxionFramePointer", code: 4) }
    let operation = args[1], app = URL(fileURLWithPath: args[3]).standardizedFileURL.path
    let stateURL = URL(fileURLWithPath: args[5])
    let saved: SavedPointer?
    if FileManager.default.fileExists(atPath: stateURL.path) {
        saved = try JSONDecoder().decode(SavedPointer.self, from: Data(contentsOf: stateURL))
    } else { saved = nil }
    if let saved { try require(saved.pid == pid && saved.app == app, "Pointer state belongs to another browser") }
    if operation == "restore" {
        if let saved {
            let position = try current()
            // Do not overwrite mouse movement performed outside this fixture.
            if abs(position.x - saved.last.x) < 2 && abs(position.y - saved.last.y) < 2 { try post(saved.original) }
        }
    } else {
        try require(operation == "move", "Unknown pointer operation")
        func owned() -> Bool {
            guard let process = NSRunningApplication(processIdentifier: pid) else { return false }
            return process.isActive && process.bundleURL?.standardizedFileURL.path == app
        }
        try require(owned(), "Exact owned Fluxion application is not active")
        try require(CGPreflightPostEventAccess(), "Native pointer event permission is unavailable")
        let data = try Data(contentsOf: URL(fileURLWithPath: args[4]))
        try require(data.count < 4096, "Pointer request exceeds fixture bounds")
        let request = try JSONDecoder().decode(Request.self, from: data)
        try require(!request.points.isEmpty && request.points.count <= 4 && request.points.allSatisfy(valid), "Invalid pointer route")
        let original: Point
        if let saved { original = saved.original } else { original = try current() }
        func checkpoint(_ point: Point) throws {
            try JSONEncoder().encode(SavedPointer(pid: pid, app: app, original: original, last: point)).write(to: stateURL, options: .atomic)
        }
        try checkpoint(current())
        for target in request.points {
            let start = try current()
            for step in 1...6 {
                try require(owned(), "Browser lost active-process ownership during pointer movement")
                let fraction = Double(step) / 6
                let point = Point(x: start.x + (target.x - start.x) * fraction, y: start.y + (target.y - start.y) * fraction)
                try post(point)
                try checkpoint(point)
            }
        }
        let final = try current(), expected = request.points.last!
        try require(abs(final.x - expected.x) < 2 && abs(final.y - expected.y) < 2, "Native pointer did not reach the requested destination")
        try JSONEncoder().encode(SavedPointer(pid: pid, app: app, original: original, last: final)).write(to: stateURL, options: .atomic)
        print(String(data: try JSONEncoder().encode(final), encoding: .utf8)!)
    }
} catch {
    fputs("Native frame pointer failed: \(error)\n", stderr)
    exit(1)
}
