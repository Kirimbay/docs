import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Uploads to the user's Yandex Disk via WebDAV: login + password, no OAuth app.
public struct YandexDiskClient: Sendable {
    public var login: String
    public var password: String
    public var webdavRoot: URL
    public var folderName: String
    public var urlSession: URLSession

    public init(
        login: String,
        password: String,
        webdavRoot: URL = URL(string: "https://webdav.yandex.ru")!,
        folderName: String = "Фотоприём",
        urlSession: URLSession = .shared
    ) {
        self.login = login
        self.password = password
        self.webdavRoot = webdavRoot
        self.folderName = folderName
        self.urlSession = urlSession
    }

    public static func basicAuthorization(login: String, password: String) -> String {
        let raw = "\(login):\(password)"
        let data = Data(raw.utf8)
        return "Basic \(data.base64EncodedString())"
    }

    public static func userFacingMessage(for error: Error) -> String {
        if let disk = error as? YandexDiskError {
            switch disk {
            case .http(401), .http(403):
                return "Неверный логин или пароль. Если включена двухфакторная защита, введи пароль приложения с id.yandex.ru, не обычный пароль."
            case .http(507):
                return "На Яндекс Диске мало места."
            case .http(let code):
                return "Яндекс Диск ответил ошибкой \(code)."
            case .badURL:
                return "Не удалось собрать адрес загрузки."
            }
        }
        return error.localizedDescription
    }

    public func ensureFolder() async throws {
        var request = URLRequest(url: try folderURL())
        request.httpMethod = "MKCOL"
        applyAuth(&request)
        let (_, response) = try await urlSession.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? -1
        // 201 created, 405/409 already exists
        if !(200...299).contains(code) && code != 405 && code != 409 {
            throw YandexDiskError.http(code)
        }
    }

    public func upload(fileURL: URL, remoteName: String) async throws {
        try await ensureFolder()
        var request = URLRequest(url: try fileURLOnDisk(remoteName))
        request.httpMethod = "PUT"
        applyAuth(&request)
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        let fileData = try Data(contentsOf: fileURL)
        let (_, putResponse) = try await urlSession.upload(for: request, from: fileData)
        let code = (putResponse as? HTTPURLResponse)?.statusCode ?? -1
        if !(200...299).contains(code) {
            throw YandexDiskError.http(code)
        }
    }

    func folderURL() throws -> URL {
        try url(appending: folderName)
    }

    func fileURLOnDisk(_ name: String) throws -> URL {
        try url(appending: folderName, name)
    }

    private func url(appending components: String...) throws -> URL {
        var path = webdavRoot.absoluteString
        if path.hasSuffix("/") { path.removeLast() }
        for part in components {
            let encoded = part.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? part
            path += "/" + encoded
        }
        guard let url = URL(string: path) else { throw YandexDiskError.badURL }
        return url
    }

    private func applyAuth(_ request: inout URLRequest) {
        request.setValue(Self.basicAuthorization(login: login, password: password), forHTTPHeaderField: "Authorization")
    }
}

public enum YandexDiskError: Error, Equatable {
    case http(Int)
    case badURL
}
