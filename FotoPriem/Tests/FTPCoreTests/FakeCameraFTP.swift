import Foundation

#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif
@testable import FTPCore

/// Camera-like FTP client: USER/PASS, TYPE I, PASV, STOR.
enum FakeCameraFTP {
    static func upload(
        host: String,
        port: UInt16,
        user: String,
        password: String,
        fileName: String,
        payload: Data
    ) throws {
        let fd = try TCPSocket.connectIPv4(ip: host, port: port)
        defer { closeSocket(fd) }
        _ = readReply(fd) // 220
        send(fd, "USER \(user)\r\n")
        _ = readReply(fd)
        send(fd, "PASS \(password)\r\n")
        let login = readReply(fd)
        guard login.hasPrefix("230") else { throw NSError(domain: "ftp", code: 530) }
        send(fd, "TYPE I\r\n")
        _ = readReply(fd)
        send(fd, "PASV\r\n")
        let pasv = readReply(fd)
        let dataPort = try parsePasvPort(pasv)
        let dataFD = try TCPSocket.connectIPv4(ip: host, port: dataPort)
        send(fd, "STOR \(fileName)\r\n")
        _ = readReply(fd) // 150
        payload.withUnsafeBytes { raw in
            _ = DarwinOrGlibcSend(dataFD, raw.baseAddress, payload.count)
        }
        closeSocket(dataFD)
        let done = readReply(fd)
        guard done.hasPrefix("226") else { throw NSError(domain: "ftp", code: 226, userInfo: [NSLocalizedDescriptionKey: done]) }
    }

    private static func send(_ fd: Int32, _ text: String) {
        TCPSocket.sendAll(fd, text)
    }

    private static func readReply(_ fd: Int32) -> String {
        TCPSocket.readLine(fd) ?? ""
    }

    private static func parsePasvPort(_ reply: String) throws -> UInt16 {
        guard let start = reply.firstIndex(of: "("), let end = reply.firstIndex(of: ")") else {
            throw NSError(domain: "ftp", code: 1, userInfo: [NSLocalizedDescriptionKey: reply])
        }
        let inner = reply[reply.index(after: start)..<end]
        let nums = inner.split(separator: ",").compactMap { Int($0) }
        guard nums.count == 6 else { throw NSError(domain: "ftp", code: 2) }
        return UInt16(nums[4] * 256 + nums[5])
    }
}

private func DarwinOrGlibcSend(_ fd: Int32, _ ptr: UnsafeRawPointer?, _ count: Int) -> Int {
    #if canImport(Darwin)
    return send(fd, ptr, count, 0)
    #else
    return send(fd, ptr, count, Int32(MSG_NOSIGNAL))
    #endif
}
