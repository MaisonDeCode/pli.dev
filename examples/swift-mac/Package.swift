// swift-tools-version: 5.9
import PackageDescription

// A small Mac app made of Pli's native blocks. `swift run` starts it, or open this folder in Xcode and press Run.
let package = Package(
    name: "PliMacExample",
    platforms: [.macOS(.v13)],
    dependencies: [.package(path: "../../packages/swift")],
    targets: [
        .executableTarget(name: "PliMacExample", dependencies: [.product(name: "Pli", package: "swift")]),
    ]
)
