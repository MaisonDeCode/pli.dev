// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Pli",
    platforms: [.macOS(.v12), .iOS(.v15), .tvOS(.v15), .watchOS(.v8), .visionOS(.v1)],
    products: [
        .library(name: "Pli", targets: ["Pli"]),
    ],
    targets: [
        // The engines are JavaScript files that JavaScriptCore runs (one each for documents, sheets, decks and PDFs, loaded only when used), and the editor is one HTML file that a web view shows. `Commands.generated.swift` is written from the same catalog the engine checks.
        .target(name: "Pli", resources: [.copy("Resources/pli-engine.js"), .copy("Resources/pli-sheets.js"), .copy("Resources/pli-decks.js"), .copy("Resources/pli-pdf.js"), .copy("Resources/pli-editor.html")]),
        .testTarget(name: "PliTests", dependencies: ["Pli"]),
    ]
)
