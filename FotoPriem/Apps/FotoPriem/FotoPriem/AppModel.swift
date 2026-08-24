import Combine
import Foundation
import FTPCore
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class AppModel: ObservableObject {
    @Published var scenario: ConnectionScenario = .cameraAccessPoint
    @Published var isRunning = false
    @Published var keepScreenOn = true
    @Published var statusMessage = "Приём не запущен"
    @Published var files: [IncomingFile] = []
    @Published var advertisedIP: String = "—"
    @Published var interfaces: [InterfaceIPv4] = []
    @Published var yandexClientID: String = UserDefaults.standard.string(forKey: "yandexClientID") ?? ""
    @Published var yandexToken: String = UserDefaults.standard.string(forKey: "yandexToken") ?? ""
    @Published var yandexBusy = false
    @Published var yandexStatus = "Не подключено"
    @Published var lastError: String?

    let credentials = FTPCredentials(username: "foto", password: "priem", port: 2121)

    private var server: FTPServer?
    private var store: IncomingStore?
    private var refreshTimer: Timer?

    var yandexButtonEnabled: Bool {
        scenario.yandexUploadAvailable && !yandexToken.isEmpty && !files.isEmpty && !yandexBusy
    }

    var yandexButtonReason: String {
        switch scenario {
        case .cameraAccessPoint:
            return "В режиме «Нет связи» интернета нет — файлы остаются в Фото"
        case .phoneHotspot:
            if yandexToken.isEmpty {
                return "Сначала войдите в Яндекс Диск"
            }
            if files.isEmpty {
                return "Пока нечего выгружать"
            }
            return "Отправить принятые файлы в Яндекс Диск"
        }
    }

    init() {
        refreshNetwork()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refreshNetwork()
            }
        }
    }

    var ftpAddressReady: Bool {
        AddressPicker.advertisedIP(interfaces: interfaces, scenario: scenario) != nil
    }

    var cameraOwnIPHint: String {
        switch scenario {
        case .cameraAccessPoint: return "192.168.1.1"
        case .phoneHotspot: return "выдаст iPhone сам"
        }
    }

    var sameNetworkHint: String {
        switch scenario {
        case .cameraAccessPoint:
            if ftpAddressReady {
                return "IP не должны совпадать. Камера: 192.168.1.1. Телефон: \(advertisedIP). В меню FTP камеры пиши \(advertisedIP) — это телефон."
            }
            return "Сначала на iPhone зайди в Wi‑Fi камеры. Потом здесь появится IP телефона вида 192.168.1.x. Его и пиши в FTP камеры. На экране «Адрес IP» у камеры оставь 192.168.1.1."
        case .phoneHotspot:
            if ftpAddressReady {
                return "IP не должны совпадать. Телефон (точка доступа): \(advertisedIP). Этот адрес пиши в FTP камеры."
            }
            return "Включи режим модема на iPhone. В FTP камеры потом будет 172.20.10.1 — это телефон, не камера."
        }
    }

    func refreshNetwork() {
        interfaces = InterfaceScanner.ipv4Interfaces()
        advertisedIP = AddressPicker.advertisedIP(interfaces: interfaces, scenario: scenario)
            ?? (scenario == .cameraAccessPoint
                ? "сначала Wi‑Fi камеры"
                : "включите режим модема")
    }

    func select(_ scenario: ConnectionScenario) {
        self.scenario = scenario
        refreshNetwork()
    }

    func toggleServer() {
        if isRunning {
            stop()
        } else {
            start()
        }
    }

    func start() {
        lastError = nil
        refreshNetwork()
        do {
            let root = try StorageLocator.writableRoot()
            let store = try IncomingStore(rootDirectory: root)
            store.onFile { [weak self] file in
                Task { @MainActor in
                    self?.files.insert(file, at: 0)
                    self?.statusMessage = "Принято: \(file.originalName)"
                    PhotoLibraryImporter.save(file)
                }
            }
            let server = FTPServer(credentials: credentials, store: store)
            try server.start()
            self.store = store
            self.server = server
            isRunning = true
            files = store.allFiles()
            statusMessage = "Слушаю FTP на порту \(credentials.port)"
            applyIdleTimer()
        } catch {
            lastError = StorageLocator.userFacingMessage(for: error)
            statusMessage = "Не удалось запустить сервер"
        }
    }

    func stop() {
        server?.stop()
        server = nil
        isRunning = false
        statusMessage = "Приём остановлен"
        applyIdleTimer()
    }

    func applyIdleTimer() {
        #if canImport(UIKit)
        UIApplication.shared.isIdleTimerDisabled = isRunning && keepScreenOn
        #endif
    }

    func handleOAuthRedirect(_ url: URL) {
        // fotopriem://oauth#access_token=...
        guard url.host == "oauth" || url.path.contains("oauth") else { return }
        let fragment = url.fragment ?? ""
        let items = fragment.split(separator: "&")
        for item in items {
            let pair = item.split(separator: "=", maxSplits: 1).map(String.init)
            if pair.count == 2, pair[0] == "access_token" {
                yandexToken = pair[1]
                UserDefaults.standard.set(pair[1], forKey: "yandexToken")
                yandexStatus = "Яндекс Диск подключён"
            }
        }
    }

    func saveClientID() {
        UserDefaults.standard.set(yandexClientID, forKey: "yandexClientID")
    }

    func yandexAuthURL() -> URL? {
        guard !yandexClientID.isEmpty else { return nil }
        var components = URLComponents(string: "https://oauth.yandex.ru/authorize")!
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "token"),
            URLQueryItem(name: "client_id", value: yandexClientID),
            URLQueryItem(name: "redirect_uri", value: "fotopriem://oauth")
        ]
        return components.url
    }

    func uploadToYandex() {
        guard yandexButtonEnabled else { return }
        yandexBusy = true
        yandexStatus = "Выгрузка…"
        let token = yandexToken
        let snapshot = files
        Task.detached {
            let client = YandexDiskClient(token: token)
            var uploaded = 0
            var failed = 0
            for file in snapshot {
                do {
                    try await client.upload(fileURL: file.storedURL, remoteName: file.originalName)
                    uploaded += 1
                } catch {
                    failed += 1
                }
            }
            await MainActor.run {
                self.yandexBusy = false
                self.yandexStatus = failed == 0
                    ? "Выгружено: \(uploaded)"
                    : "Выгружено \(uploaded), ошибок \(failed)"
            }
        }
    }
}
