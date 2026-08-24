import Foundation

public enum YandexOAuth {
    /// Yandex's own callback page. In the OAuth console press «Подставить URL для разработки».
    public static let redirectURI = "https://oauth.yandex.ru/verification_code"

    public static func authorizeURL(clientID: String) -> URL {
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
