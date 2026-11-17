#!/usr/bin/env swift
// Saves what is on the clipboard, as another application put it there, as a test fixture for rich paste.
//
//   1. In Word, Google Docs, Excel, Numbers, Pages, Google Sheets… select some content and copy it (Cmd+C).
//   2. Run:  swift scripts/capture-clipboard.swift word-heading-list-table
//      or, for cells copied from Excel or Google Sheets:  swift scripts/capture-clipboard.swift excel-formulas sheets
//
// The files go in packages/docs/test/fixtures/clipboard/<name>/ and are read by the paste tests; with `sheets` they go in
// packages/sheets/test/fixtures/clipboard/captured/<name>/, and `pnpm vitest run packages/sheets/test/clipboard-captured.test.ts`
// pastes each one and checks that the HTML and the plain text agree. Use only content that is fine to keep in a public repository.
import AppKit
import Foundation

let args = CommandLine.arguments
guard (args.count == 2 || (args.count == 3 && args[2] == "sheets")), args[1].range(of: "^[a-z0-9][a-z0-9-]*$", options: .regularExpression) != nil else {
    FileHandle.standardError.write(Data("usage: swift scripts/capture-clipboard.swift <name-in-lowercase-with-dashes> [sheets]\n".utf8))
    exit(2)
}
let area = args.count == 3 ? "packages/sheets/test/fixtures/clipboard/captured" : "packages/docs/test/fixtures/clipboard"
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("\(area)/\(args[1])")
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

let board = NSPasteboard.general
let wanted: [(NSPasteboard.PasteboardType, String)] = [
    (.html, "text.html"),
    (.rtf, "text.rtf"),
    (.string, "text.txt"),
    (NSPasteboard.PasteboardType("org.chromium.web-custom-data"), "chromium-custom-data.bin"),
]
var saved: [String] = []
for (type, file) in wanted {
    if var data = board.data(forType: type), !data.isEmpty {
        // Applications put the path of their temporary files in what they copy. Keep this machine's user name out of the repository.
        if file.hasSuffix(".html") || file.hasSuffix(".rtf") || file.hasSuffix(".txt"), let home = NSHomeDirectory().data(using: .utf8), let anon = "/Users/user".data(using: .utf8) {
            data = data.replacingOccurrences(of: home, with: anon)
        }
        try data.write(to: root.appendingPathComponent(file))
        saved.append("\(file) (\(data.count) bytes)")
    }
}
let types = (board.types ?? []).map(\.rawValue)
try (types.joined(separator: "\n") + "\n").write(to: root.appendingPathComponent("types.txt"), atomically: true, encoding: .utf8)
print("Saved to \(root.path):")
saved.forEach { print("  \($0)") }
print("Clipboard types: \(types.joined(separator: ", "))")
if saved.isEmpty { print("Nothing usable was on the clipboard. Copy something first.") ; exit(1) }

extension Data {
    func replacingOccurrences(of target: Data, with replacement: Data) -> Data {
        var out = Data()
        var index = startIndex
        while index < endIndex {
            if let range = self[index...].range(of: target) {
                out.append(self[index..<range.lowerBound])
                out.append(replacement)
                index = range.upperBound
            } else {
                out.append(self[index...])
                break
            }
        }
        return out
    }
}
