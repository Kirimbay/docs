// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FotoPriem",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .library(name: "FTPCore", targets: ["FTPCore"]),
        .executable(name: "fotopriem-server", targets: ["FotoPriemCLI"])
    ],
    targets: [
        .target(name: "FTPCore"),
        .executableTarget(
            name: "FotoPriemCLI",
            dependencies: ["FTPCore"]
        ),
        .testTarget(
            name: "FTPCoreTests",
            dependencies: ["FTPCore"]
        )
    ]
)
