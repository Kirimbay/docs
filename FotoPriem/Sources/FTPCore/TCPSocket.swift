import Foundation

#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

enum POSIXError: Error, CustomStringConvertible {
    case failed(String, errno: Int32)

    var description: String {
        switch self {
        case .failed(let op, let errno):
            return "\(op) failed: \(String(cString: strerror(errno))) (\(errno))"
        }
    }
}

enum TCPSocket {
    static func openStream() throws -> Int32 {
        #if os(Linux)
        let fd = socket(AF_INET, Int32(SOCK_STREAM.rawValue), Int32(IPPROTO_TCP))
        #else
        let fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
        #endif
        if fd < 0 { throw POSIXError.failed("socket", errno: errno) }
        return fd
    }

    static func listenIPv4(port: UInt16, queue: Int32 = 16) throws -> Int32 {
        let fd = try openStream()
        var yes: Int32 = 1
        _ = setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        #if canImport(Darwin)
        _ = setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size))
        #endif

        var addr = sockaddr_in()
        memset(&addr, 0, MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr = in_addr(s_addr: INADDR_ANY.bigEndian)

        let bindResult = withUnsafePointer(to: &addr) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        if bindResult != 0 {
            close(fd)
            throw POSIXError.failed("bind :\(port)", errno: errno)
        }
        if listen(fd, queue) != 0 {
            close(fd)
            throw POSIXError.failed("listen", errno: errno)
        }
        return fd
    }

    static func acceptIPv4(_ fd: Int32) throws -> (fd: Int32, ip: String) {
        var addr = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let client = withUnsafeMutablePointer(to: &addr) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                accept(fd, $0, &len)
            }
        }
        if client < 0 { throw POSIXError.failed("accept", errno: errno) }
        var yes: Int32 = 1
        #if canImport(Darwin)
        _ = setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size))
        #endif
        return (client, ipv4String(addr.sin_addr) ?? "0.0.0.0")
    }

    static func connectIPv4(ip: String, port: UInt16) throws -> Int32 {
        let fd = try openStream()
        var addr = sockaddr_in()
        memset(&addr, 0, MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        if inet_pton(AF_INET, ip, &addr.sin_addr) != 1 {
            close(fd)
            throw POSIXError.failed("inet_pton \(ip)", errno: errno)
        }
        let result = withUnsafePointer(to: &addr) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        if result != 0 {
            close(fd)
            throw POSIXError.failed("connect \(ip):\(port)", errno: errno)
        }
        return fd
    }

    static func localIPv4(_ fd: Int32) -> (ip: String, port: UInt16)? {
        var addr = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let ok = withUnsafeMutablePointer(to: &addr) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(fd, $0, &len)
            }
        }
        guard ok == 0 else { return nil }
        guard let ip = ipv4String(addr.sin_addr) else { return nil }
        return (ip, UInt16(bigEndian: addr.sin_port))
    }

    static func ipv4String(_ addr: in_addr) -> String? {
        var copy = addr
        var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        guard inet_ntop(AF_INET, &copy, &buf, socklen_t(INET_ADDRSTRLEN)) != nil else { return nil }
        return String(cString: buf)
    }

    static func sendAll(_ fd: Int32, _ text: String) {
        var bytes = Array(text.utf8)
        var sent = 0
        let total = bytes.count
        while sent < total {
            let remaining = total - sent
            let n: Int = bytes.withUnsafeMutableBytes { raw in
                let ptr = raw.baseAddress!.advanced(by: sent)
                #if canImport(Darwin)
                return send(fd, ptr, remaining, 0)
                #else
                return send(fd, ptr, remaining, Int32(MSG_NOSIGNAL))
                #endif
            }
            if n <= 0 { return }
            sent += n
        }
    }

    static func readLine(_ fd: Int32, limit: Int = 8192) -> String? {
        var line = [UInt8]()
        var byte: UInt8 = 0
        while line.count < limit {
            let n = recv(fd, &byte, 1, 0)
            if n == 0 { return line.isEmpty ? nil : String(bytes: line, encoding: .utf8) }
            if n < 0 { return nil }
            if byte == 10 { break } // \n
            if byte != 13 { line.append(byte) }
        }
        return String(bytes: line, encoding: .utf8) ?? String(bytes: line, encoding: .isoLatin1)
    }

    static func readAll(_ fd: Int32) -> Data {
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let n = buffer.withUnsafeMutableBytes { raw in
                recv(fd, raw.baseAddress, raw.count, 0)
            }
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }
}
