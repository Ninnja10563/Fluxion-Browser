// CI-only pasteboard custodian. Prior clipboard formats stay in memory, never
// in browser prefs, artifacts, command arguments, or temporary backup files.
import AppKit
import Foundation

enum ClipboardFailure: Error { case unavailable(String) }
func run() throws {
let args = CommandLine.arguments
guard args.count == 4 else { fatalError("Expected driver directory, token and loopback origin") }
let directory = URL(fileURLWithPath: args[1], isDirectory: true)
let token = args[2], origin = args[3]
guard token.range(of: "^[A-Za-z0-9.-]+$", options: .regularExpression) != nil,
      origin.range(of: "^http://127\\.0\\.0\\.1:[0-9]+$", options: .regularExpression) != nil else {
    fatalError("Invalid owned clipboard fixture")
}
let sentinel = "Fluxion clipboard verification \(token)"
let single = "https://fluxion-link-fixture.invalid/first?token=\(token)&raw=%2f+#part%2f"
let multiple = "\(origin)/transfer?token=\(token)&tab=one#first\n\(origin)/transfer?token=\(token)&tab=two#second"
let ownedValues = Set([sentinel, single, multiple])
let board = NSPasteboard.general
let initialChange = board.changeCount
var previous: [NSPasteboardItem] = []
for item in board.pasteboardItems ?? [] {
    let copy = NSPasteboardItem()
    for type in item.types {
        guard let data = item.data(forType: type), copy.setData(data, forType: type) else {
            fatalError("Cannot safely preserve every existing clipboard format")
        }
    }
    previous.append(copy)
}
guard board.changeCount == initialChange else { fatalError("Clipboard changed before fixture acquired it") }
func write(_ name: String, _ text: String) throws {
    try Data(text.utf8).write(to: directory.appendingPathComponent(name), options: .atomic)
}
board.clearContents()
let acquiredEmptyChange = board.changeCount
// Also restore on any thrown handshake/byte-verification write error. The
// runner requests graceful finish on EXIT/INT/TERM; it never kills this owner.
defer {
    let current = board.string(forType: .string)
    if current.map({ ownedValues.contains($0) }) == true || board.changeCount == acquiredEmptyChange {
        board.clearContents()
        let restored = previous.isEmpty || board.writeObjects(previous)
        try? write(restored ? "clipboard.restored" : "clipboard.error",
                   restored ? "all-prior-formats-restored" : "Could not restore preserved clipboard formats")
    } else {
        try? write("clipboard.restored", "external-clipboard-change-left-untouched")
    }
}
guard board.setString(sentinel, forType: .string) else { throw ClipboardFailure.unavailable("Could not seed owned clipboard") }
try write("clipboard.ready", "ready")
let expected = ["read-initial": sentinel, "read-single": single, "read-multiple": multiple, "read-disabled": multiple]
let deadline = Date().addingTimeInterval(240)
while !FileManager.default.fileExists(atPath: directory.appendingPathComponent("clipboard.finish").path) && Date() < deadline {
    for (name, value) in expected {
        if FileManager.default.fileExists(atPath: directory.appendingPathComponent(name + ".ready").path) &&
            !FileManager.default.fileExists(atPath: directory.appendingPathComponent(name + ".sent").path) {
            if board.string(forType: .string) == value {
                try write(name + ".sent", "exact-native-pasteboard-text-matched")
            } else {
                try write("clipboard.error", "Native pasteboard did not match the expected owned fixture value")
            }
        }
    }
    Thread.sleep(forTimeInterval: 0.05)
}
}
do { try run() }
catch {
    // Error messages deliberately contain neither previous nor current bytes.
    fputs("Clipboard custodian could not complete the verification handshake.\n", stderr)
    exit(1)
}
