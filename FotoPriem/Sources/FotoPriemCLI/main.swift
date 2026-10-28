import Foundation
import FTPCore
#if canImport(Glibc)
import Glibc
#endif

@main
struct FotoPriemCLI {
    static func main() throws {
        let args = Array(CommandLine.arguments.dropFirst())
        let port = UInt16(value(for: "--port", in: args) ?? "2121") ?? 2121
        let user = value(for: "--user", in: args) ?? "foto"
        let password = value(for: "--pass", in: args) ?? "priem"
        let rootPath = value(for: "--root", in: args) ?? FileManager.default.currentDirectoryPath + "/inbox"

        let store = try IncomingStore(rootDirectory: URL(fileURLWithPath: rootPath))
        store.onFile { file in
            let kb = max(1, file.byteCount / 1024)
            print("RECEIVED\t\(file.kind.rawValue)\t\(file.byteCount)\t\(kb)KB\t\(file.originalName)\t\(file.storedURL.path)")
            fflush(stdout)
        }

        let server = FTPServer(
            credentials: FTPCredentials(username: user, password: password, port: port),
            store: store
        )
        try server.start()

        let interfaces = InterfaceScanner.ipv4Interfaces()
        print("READY port=\(port) user=\(user) root=\(rootPath)")
        for iface in interfaces {
            print("IFACE \(iface.name) \(iface.ip)\(iface.isHotspot ? " hotspot" : "")")
        }
        print("ADVERTISED_CAMERA \(AddressPicker.advertisedIP(interfaces: interfaces, scenario: .cameraAccessPoint) ?? "none")")
        print("ADVERTISED_HOTSPOT \(AddressPicker.advertisedIP(interfaces: interfaces, scenario: .phoneHotspot) ?? "none")")
        fflush(stdout)

        while true {
            Thread.sleep(forTimeInterval: 3600)
        }
    }

    static func value(for flag: String, in args: [String]) -> String? {
        guard let index = args.firstIndex(of: flag), index + 1 < args.count else { return nil }
        return args[index + 1]
    }
}
