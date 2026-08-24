import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Yandex Disk REST API with an OAuth token from the Yandex login page.
public struct YandexDiskClient: Sendable {
    public var token: String
    public var apiRoot: URL
    public var folderPath: String
    public var urlSession: URLSession

    public init(
        token: String,
        apiRoot: URL = URL(string: "https://cloud-api.yandex.net/v1/disk/")!,
        folderPath: String = "disk:/Фотоприём",
        urlSession: URLSession = .shared
    ) {
        self.token = token
        self.apiRoot = apiRoot
        self.folderPath = folderPath
        self.urlSession = urlSession
    }

    public static func userFacingMessage(for error: Error) -> String {
        if let disk = error as? YandexDiskError {
            switch disk {
            case .http(401), .http(403):
                return "Яндекс не пустил к Диску. Выйди и войди ещё раз, в приложении на oauth.yandex.ru должны быть права на Диск."
            case .http(507):
                return "На Яндекс Диске мало места."
            case .http(let code):
                return "Яндекс Диск ответил ошибкой \(code)."
            case .badHref:
                return "Яндекс не дал ссылку для загрузки."
            }
        }
        return error.localizedDescription
    }

    public func ensureFolder() async throws {
        var components = URLComponents(url: apiRoot.appendingPathComponent("resources"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "path", value: folderPath)]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "PUT"
        request.setValue("OAuth \(token)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await urlSession.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? -1
        if !(200...409).contains(code) {
            throw YandexDiskError.http(code)
        }
    }

    public func upload(fileURL: URL, remoteName: String) async throws {
        try await ensureFolder()
        let remotePath = folderPath.hasSuffix("/") ? folderPath + remoteName : folderPath + "/" + remoteName
        var components = URLComponents(url: apiRoot.appendingPathComponent("resources/upload"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "path", value: remotePath),
            URLQueryItem(name: "overwrite", value: "true")
        ]
        var hrefRequest = URLRequest(url: components.url!)
        hrefRequest.setValue("OAuth \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await urlSession.data(for: hrefRequest)
        let code = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200...299).contains(code) else { throw YandexDiskError.http(code) }
        struct Href: Decodable { let href: String }
        let href = try JSONDecoder().decode(Href.self, from: data)
        guard let uploadURL = URL(string: href.href) else { throw YandexDiskError.badHref }

        var upload = URLRequest(url: uploadURL)
        upload.httpMethod = "PUT"
        upload.setValue("OAuth \(token)", forHTTPHeaderField: "Authorization")
        let fileData = try Data(contentsOf: fileURL)
        let (_, putResponse) = try await urlSession.upload(for: upload, from: fileData)
        let putCode = (putResponse as? HTTPURLResponse)?.statusCode ?? -1
        if !(200...299).contains(putCode) {
            throw YandexDiskError.http(putCode)
        }
    }
}

public enum YandexDiskError: Error, Equatable {
    case http(Int)
    case badHref
}
