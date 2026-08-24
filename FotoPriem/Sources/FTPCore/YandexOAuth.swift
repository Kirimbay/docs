import Foundation

public enum YandexOAuth {
    /// Public OAuth client of FotoPriem itself. End users never type this.
    /// Fill once from https://oauth.yandex.ru after enabling Disk + default callback URL.
    public static let clientID = ""

    /// Yandex's built-in callback page («Подставить URL для разработки»).
    public static let redirectURI = "https://oauth.yandex.ru/verification_code"

    public static var isConfigured: Bool {
        !clientID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public static func authorizeURL(clientID: String = YandexOAuth.clientID) -> URL {
        var components = URLComponents(string: "https://oauth.yandex.ru/authorize")!
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "token"),
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "scope", value: "cloud_api:disk.write cloud_api:disk.read"),
            URLQueryItem(name: "force_confirm", value: "yes")
        ]
        return components.url!
    }

    public static func accessToken(from url: URL) -> String? {
        let blobs = [url.fragment, url.query].compactMap { $0 }
        for blob in blobs {
            for item in blob.split(separator: "&") {
                let pair = item.split(separator: "=", maxSplits: 1).map(String.init)
                if pair.count == 2, pair[0] == "access_token" {
                    return pair[1].removingPercentEncoding ?? pair[1]
                }
            }
        }
        return nil
    }
}
