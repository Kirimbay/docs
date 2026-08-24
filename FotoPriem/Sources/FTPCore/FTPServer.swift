import Foundation

#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

public struct FTPCredentials: Equatable, Sendable {
    public var username: String
    public var password: String
    public var port: UInt16

    public init(username: String = "foto", password: String = "priem", port: UInt16 = 2121) {
        self.username = username
        self.password = password
        self.port = port
    }
}

public final class FTPServer: @unchecked Sendable {
    public let credentials: FTPCredentials
    public let store: IncomingStore
    public private(set) var isRunning = false

    private var listenFD: Int32 = -1
    private var acceptThread: Thread?
    private let lock = NSLock()
    private var sessions: [Int32] = []

    public init(credentials: FTPCredentials, store: IncomingStore) {
        self.credentials = credentials
        self.store = store
    }

    public func start() throws {
        lock.lock()
        defer { lock.unlock() }
        guard !isRunning else { return }
        listenFD = try TCPSocket.listenIPv4(port: credentials.port)
        isRunning = true
        let fd = listenFD
        acceptThread = Thread { [weak self] in
            self?.acceptLoop(listenFD: fd)
        }
        acceptThread?.name = "FotoPriem.FTPAccept"
        acceptThread?.start()
    }

    public func stop() {
        lock.lock()
        isRunning = false
        let fd = listenFD
        let openSessions = sessions
        listenFD = -1
        sessions = []
        lock.unlock()

        if fd >= 0 { closeSocket(fd) }
        openSessions.forEach { closeSocket($0) }
    }

    private func acceptLoop(listenFD: Int32) {
        while true {
            lock.lock()
            let running = isRunning
            lock.unlock()
            if !running { break }
            do {
                let client = try TCPSocket.acceptIPv4(listenFD)
                lock.lock()
                sessions.append(client.fd)
                lock.unlock()
                Thread.detachNewThread { [weak self] in
                    guard let self else { return }
                    FTPSession(
                        fd: client.fd,
                        peerIP: client.ip,
                        credentials: self.credentials,
                        store: self.store
                    ).run()
                    self.removeSession(client.fd)
                }
            } catch {
                lock.lock()
                let running = isRunning
                lock.unlock()
                if !running { break }
            }
        }
    }

    private func removeSession(_ fd: Int32) {
        lock.lock()
        sessions.removeAll { $0 == fd }
        lock.unlock()
        closeSocket(fd)
    }
}

func closeSocket(_ fd: Int32) {
    #if canImport(Darwin)
    Darwin.close(fd)
    #else
    Glibc.close(fd)
    #endif
}
