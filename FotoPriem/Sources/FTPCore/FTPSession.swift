import Foundation

#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

final class FTPSession {
    private let fd: Int32
    private let peerIP: String
    private let credentials: FTPCredentials
    private let store: IncomingStore
    private var loggedIn = false
    private var username: String?
    private var renameFrom: String?
    private var workingDir = "/"
    private var dataPort: UInt16?
    private var dataListenFD: Int32 = -1
    private var activeTarget: (ip: String, port: UInt16)?
    private var restOffset: Int = 0

    init(fd: Int32, peerIP: String, credentials: FTPCredentials, store: IncomingStore) {
        self.fd = fd
        self.peerIP = peerIP
        self.credentials = credentials
        self.store = store
    }

    func run() {
        reply(220, "FotoPriem FTP ready")
        while let line = TCPSocket.readLine(fd) {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }
            let parts = splitCommand(trimmed)
            let command = parts.command
            let argument = parts.argument
            if !handle(command: command, argument: argument) {
                break
            }
        }
        if dataListenFD >= 0 { closeSocket(dataListenFD) }
    }

    private func handle(command: String, argument: String) -> Bool {
        switch command {
        case "USER":
            username = argument
            reply(331, "Password required")
        case "PASS":
            if username == credentials.username && argument == credentials.password {
                loggedIn = true
                reply(230, "Logged in")
            } else {
                loggedIn = false
                reply(530, "Login incorrect")
            }
        case "QUIT":
            reply(221, "Bye")
            return false
        case "NOOP", "NOP":
            reply(200, "OK")
        case "SYST":
            reply(215, "UNIX Type: L8")
        case "FEAT":
            TCPSocket.sendAll(fd, "211-Features:\r\n UTF8\r\n PASV\r\n EPSV\r\n SIZE\r\n REST STREAM\r\n211 End\r\n")
        case "OPTS":
            reply(200, "OK")
        case "TYPE":
            reply(200, "Type set to I")
        case "MODE":
            reply(200, "Mode OK")
        case "STRU":
            reply(200, "STRU F OK")
        case "PWD", "XPWD":
            reply(257, "\"\(workingDir)\" is current directory")
        case "CWD", "XCWD":
            workingDir = argument.hasPrefix("/") ? argument : "\(workingDir)/\(argument)"
            if workingDir.isEmpty { workingDir = "/" }
            reply(250, "Directory changed")
        case "CDUP":
            workingDir = "/"
            reply(250, "Directory changed")
        case "MKD", "XMKD":
            reply(257, "\"\(argument)\" created")
        case "RMD", "XRMD":
            reply(250, "Directory removed")
        case "DELE":
            reply(250, "Deleted")
        case "RNFR":
            renameFrom = argument
            reply(350, "Ready for RNTO")
        case "RNTO":
            renameFrom = nil
            reply(250, "Renamed")
        case "REST":
            restOffset = Int(argument) ?? 0
            reply(350, "Restarting at \(restOffset)")
        case "PASV":
            startPassive()
        case "EPSV":
            startPassive(extended: true)
        case "PORT":
            parsePort(argument)
        case "EPRT":
            parseEPRT(argument)
        case "LIST", "NLST":
            sendListing()
        case "SIZE":
            reply(550, "File not found")
        case "STOR", "STOU", "APPE":
            receiveFile(named: argument.isEmpty ? "upload.bin" : argument)
        case "RETR":
            reply(550, "Download disabled")
        case "AUTH":
            reply(502, "TLS not used on local camera link")
        case "PBSZ", "PROT":
            reply(200, "OK")
        case "CLNT", "HELP":
            reply(200, "OK")
        default:
            reply(502, "Command not implemented")
        }
        return true
    }

    private func startPassive(extended: Bool = false) {
        if dataListenFD >= 0 {
            closeSocket(dataListenFD)
            dataListenFD = -1
        }
        do {
            let listen = try TCPSocket.listenIPv4(port: 0)
            guard let local = TCPSocket.localIPv4(listen) else {
                closeSocket(listen)
                reply(425, "Cannot open data connection")
                return
            }
            dataListenFD = listen
            dataPort = local.port
            activeTarget = nil

            var ip = TCPSocket.localIPv4(fd)?.ip ?? "127.0.0.1"
            if ip == "0.0.0.0" || ip.hasPrefix("127.") {
                ip = AddressPicker.advertisedIP(
                    interfaces: InterfaceScanner.ipv4Interfaces(),
                    scenario: .cameraAccessPoint
                ) ?? ip
            }
            if extended {
                reply(229, "Entering Extended Passive Mode (|||\(local.port)|)")
            } else {
                let parts = ip.split(separator: ".").map(String.init)
                guard parts.count == 4 else {
                    reply(425, "Cannot open data connection")
                    return
                }
                let p1 = Int(local.port / 256)
                let p2 = Int(local.port % 256)
                let h = parts.joined(separator: ",")
                reply(227, "Entering Passive Mode (\(h),\(p1),\(p2))")
            }
        } catch {
            reply(425, "Cannot open data connection")
        }
    }

    private func parsePort(_ argument: String) {
        let nums = argument.split(whereSeparator: { $0 == "," || $0 == " " }).compactMap { Int($0) }
        guard nums.count == 6 else {
            reply(501, "Bad PORT")
            return
        }
        let ip = "\(nums[0]).\(nums[1]).\(nums[2]).\(nums[3])"
        let port = UInt16(nums[4] * 256 + nums[5])
        activeTarget = (ip, port)
        if dataListenFD >= 0 {
            closeSocket(dataListenFD)
            dataListenFD = -1
        }
        reply(200, "PORT OK")
    }

    private func parseEPRT(_ argument: String) {
        // |2|::1|1234| or |1|127.0.0.1|1234|
        let trimmed = argument.trimmingCharacters(in: CharacterSet(charactersIn: "|"))
        let parts = trimmed.split(separator: "|").map(String.init)
        guard parts.count >= 3, let port = UInt16(parts[2]) else {
            reply(501, "Bad EPRT")
            return
        }
        activeTarget = (parts[1], port)
        reply(200, "EPRT OK")
    }

    private func openData() -> Int32? {
        if let target = activeTarget {
            activeTarget = nil
            return try? TCPSocket.connectIPv4(ip: target.ip, port: target.port)
        }
        guard dataListenFD >= 0 else { return nil }
        do {
            let client = try TCPSocket.acceptIPv4(dataListenFD)
            closeSocket(dataListenFD)
            dataListenFD = -1
            return client.fd
        } catch {
            return nil
        }
    }

    private func sendListing() {
        reply(150, "Opening data connection")
        guard let dataFD = openData() else {
            reply(425, "Cannot open data connection")
            return
        }
        let listing = "drwxr-xr-x 1 foto foto 0 Jan 1 00:00 .\r\n"
        TCPSocket.sendAll(dataFD, listing)
        closeSocket(dataFD)
        reply(226, "Transfer complete")
    }

    private func receiveFile(named name: String) {
        if !loggedIn {
            reply(530, "Please login")
            return
        }
        reply(150, "Opening data connection")
        guard let dataFD = openData() else {
            reply(425, "Cannot open data connection")
            return
        }
        let data = TCPSocket.readAll(dataFD)
        closeSocket(dataFD)
        do {
            _ = try store.save(originalPath: name, data: data)
            reply(226, "Transfer complete")
        } catch {
            reply(451, "Save failed")
        }
        restOffset = 0
    }

    private func reply(_ code: Int, _ message: String) {
        TCPSocket.sendAll(fd, "\(code) \(message)\r\n")
    }

    private func splitCommand(_ line: String) -> (command: String, argument: String) {
        guard let space = line.firstIndex(of: " ") else {
            return (line.uppercased(), "")
        }
        let command = String(line[..<space]).uppercased()
        let argument = String(line[line.index(after: space)...])
        return (command, argument)
    }
}
