import SwiftUI
import WebKit
import FTPCore

struct YandexLoginView: View {
    let clientID: String
    var onToken: (String) -> Void
    var onCancel: () -> Void

    var body: some View {
        NavigationStack {
            YandexWebView(
                url: YandexOAuth.authorizeURL(clientID: clientID),
                onToken: onToken
            )
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle("Яндекс Диск")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть", action: onCancel)
                }
            }
        }
    }
}

private struct YandexWebView: UIViewRepresentable {
    let url: URL
    var onToken: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onToken: onToken)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let onToken: (String) -> Void
        private var finished = false

        init(onToken: @escaping (String) -> Void) {
            self.onToken = onToken
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if capture(url: navigationAction.request.url) || capture(url: webView.url) {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            _ = capture(url: webView.url)
            webView.evaluateJavaScript("window.location.href") { [weak self] result, _ in
                if let href = result as? String, let url = URL(string: href) {
                    _ = self?.capture(url: url)
                }
            }
        }

        @discardableResult
        private func capture(url: URL?) -> Bool {
            guard !finished, let url, let token = YandexOAuth.accessToken(from: url) else {
                return false
            }
            finished = true
            DispatchQueue.main.async {
                self.onToken(token)
            }
            return true
        }
    }
}
