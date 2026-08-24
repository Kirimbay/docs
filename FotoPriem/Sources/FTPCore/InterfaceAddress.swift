import Foundation

#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

public struct InterfaceIPv4: Equatable, Sendable, Identifiable {
    public var id: String { "\(name)-\(ip)" }
    public var name: String
    public var ip: String

    public init(name: String, ip: String) {
        self.name = name
        self.ip = ip
    }

    public var isLoopback: Bool {
        ip.hasPrefix("127.") || name == "lo" || name == "lo0"
    }

    /// iPhone Personal Hotspot typically lands on bridge100 / 172.20.10.1
    public var isHotspot: Bool {
        name.hasPrefix("bridge") || name.hasPrefix("ap") || ip.hasPrefix("172.20.10.")
    }
}

public enum InterfaceScanner {
    public static func ipv4Interfaces() -> [InterfaceIPv4] {
        var result: [InterfaceIPv4] = []
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return [] }
        defer { freeifaddrs(first) }

        var ptr: UnsafeMutablePointer<ifaddrs>? = first
        while let current = ptr {
            let flags = Int32(current.pointee.ifa_flags)
            let isUp = (flags & Int32(IFF_UP)) != 0
            let isLoop = (flags & Int32(IFF_LOOPBACK)) != 0
            if isUp, let addr = current.pointee.ifa_addr, Int32(addr.pointee.sa_family) == AF_INET {
                addr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { sin in
                    var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                    var saddr = sin.pointee.sin_addr
                    if inet_ntop(AF_INET, &saddr, &buf, socklen_t(INET_ADDRSTRLEN)) != nil {
                        let ip = String(cString: buf)
                        let name = String(cString: current.pointee.ifa_name)
                        if !isLoop {
                            result.append(InterfaceIPv4(name: name, ip: ip))
                        }
                    }
                }
            }
            ptr = current.pointee.ifa_next
        }
        return result
    }
}

public enum AddressPicker {
    /// IP the camera must type into its FTP settings.
    public static func advertisedIP(
        interfaces: [InterfaceIPv4],
        scenario: ConnectionScenario
    ) -> String? {
        let usable = interfaces.filter { !$0.isLoopback }
        switch scenario {
        case .phoneHotspot:
            if let hotspot = usable.first(where: { $0.isHotspot }) {
                return hotspot.ip
            }
            return usable.first?.ip
        case .cameraAccessPoint:
            if let wifi = usable.first(where: { !$0.isHotspot }) {
                return wifi.ip
            }
            return usable.first?.ip
        }
    }
}
