import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Minimal Yandex Disk REST client. Uploads go to the user's own disk.
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

    public func ensureFolder() async throws {
        var components = URLComponents(url: apiRoot.appendingPathComponent("resources"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "path", value: folderPath)]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "PUT"
        request.setValue("OAuth \(token)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await urlSession.data(for: request)
        if let http = response as? HTTPURLResponse, !(200...409).contains(http.statusCode) {
            throw YandexDiskError.http(http.statusCode)
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
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw YandexDiskError.http((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        struct Href: Decodable { let href: String }
        let href = try JSONDecoder().decode(Href.self, from: data)
        guard let uploadURL = URL(string: href.href) else { throw YandexDiskError.badHref }

        var upload = URLRequest(url: uploadURL)
        upload.httpMethod = "PUT"
        upload.setValue("OAuth \(token)", forHTTPHeaderField: "Authorization")
        let fileData = try Data(contentsOf: fileURL)
        let (_, putResponse) = try await urlSession.upload(for: upload, from: fileData)
        guard let putHTTP = putResponse as? HTTPURLResponse, (200...299).contains(putHTTP.statusCode) else {
            throw YandexDiskError.http((putResponse as? HTTPURLResponse)?.statusCode ?? -1)
        }
    }
}

public enum YandexDiskError: Error, Equatable {
    case http(Int)
    case badHref
}
