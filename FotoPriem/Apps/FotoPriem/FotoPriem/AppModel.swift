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
    @Published var yandexToken: String = UserDefaults.standard.string(forKey: "yandexToken") ?? ""
    @Published var yandexBusy = false
    @Published var yandexStatus = "Не подключено"
    @Published var showYandexLogin = false
    @Published var lastError: String?

    let credentials = FTPCredentials(username: "foto", password: "priem", port: 2121)

    private var server: FTPServer?
    private var store: IncomingStore?
    private var refreshTimer: Timer?

    var resolvedYandexClientID: String {
        YandexOAuth.clientID
    }

    var hasYandexClientID: Bool {
        YandexOAuth.isConfigured
    }

    var isYandexLoggedIn: Bool {
        !yandexToken.isEmpty
    }

    var yandexButtonEnabled: Bool {
        scenario.yandexUploadAvailable
            && hasYandexClientID
            && !files.isEmpty
            && !yandexBusy
    }

    var yandexButtonReason: String {
        switch scenario {
        case .cameraAccessPoint:
            return "В режиме «Нет связи» интернета нет — файлы остаются в Фото"
        case .phoneHotspot:
            if !hasYandexClientID {
                return "Вход Яндекса ещё не подключён в этой сборке. Пользователям ничего вводить не нужно — только кнопка входа."
            }
            if files.isEmpty {
                return "Сначала прими фото, потом кнопка откроет вход Яндекса"
            }
            if isYandexLoggedIn {
                return "Вход есть. Файлы уйдут в папку приложения на Яндекс Диске."
            }
            return "Откроется страница Яндекса. Войди как обычно — пароль приложения не нужен."
        }
    }

    init() {
        refreshNetwork()
        if !yandexToken.isEmpty {
            yandexStatus = "Яндекс подключён"
        }
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refreshNetwork()
            }
        }
    }

    var ftpAddressReady: Bool {
        AddressPicker.advertisedIP(interfaces: interfaces, scenario: scenario) != nil
    }

    var ftpTargetForCamera: String {
        PlannedPhoneAddress.ftpTarget(for: scenario)
    }

    var phoneHasPlannedIP: Bool {
        PlannedPhoneAddress.currentMatchesPlan(
            AddressPicker.advertisedIP(interfaces: interfaces, scenario: scenario),
            scenario: scenario
        )
    }

    var cameraOwnIPHint: String {
        switch scenario {
        case .cameraAccessPoint: return PlannedPhoneAddress.cameraGatewayIP
        case .phoneHotspot: return "выдаст iPhone сам"
        }
    }

    var sameNetworkHint: String {
        switch scenario {
        case .cameraAccessPoint:
            if phoneHasPlannedIP {
                return "Телефон уже на \(ftpTargetForCamera). В FTP камеры так и оставь: адрес \(ftpTargetForCamera), порт \(credentials.port)."
            }
            return """
            Камера спрашивает IP до подключения телефона — это нормально. В FTP сразу пиши \(ftpTargetForCamera), порт \(credentials.port).
            Потом на iPhone: Настройки → Wi‑Fi → сеть камеры → кнопка i → Настроить IP → Вручную:
            IP \(ftpTargetForCamera), маска \(PlannedPhoneAddress.subnetMask), маршрутизатор \(PlannedPhoneAddress.cameraGatewayIP). Частный адрес Wi‑Fi выключи.
            Приложение само IP телефона сменить не может.
            """
        case .phoneHotspot:
            return "У точки доступа iPhone адрес почти всегда \(PlannedPhoneAddress.phoneHotspotIP). Его и пиши в FTP камеры."
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

    func logoutYandex() {
        yandexToken = ""
        UserDefaults.standard.removeObject(forKey: "yandexToken")
        yandexStatus = "Вышел из Яндекса"
    }

    func finishYandexLogin(token: String) {
        yandexToken = token
        UserDefaults.standard.set(token, forKey: "yandexToken")
        showYandexLogin = false
        yandexStatus = "Яндекс подключён"
        performYandexUpload()
    }

    func uploadToYandex() {
        guard yandexButtonEnabled else { return }
        if yandexToken.isEmpty {
            yandexBusy = true
            yandexStatus = "Открываю вход Яндекса…"
            showYandexLogin = true
            return
        }
        performYandexUpload()
    }

    private func performYandexUpload() {
        yandexBusy = true
        yandexStatus = "Выгрузка…"
        let token = yandexToken
        let snapshot = files
        Task.detached {
            let client = YandexDiskClient(token: token)
            var uploaded = 0
            var lastError: Error?
            for file in snapshot {
                do {
                    try await client.upload(fileURL: file.storedURL, remoteName: file.originalName)
                    uploaded += 1
                } catch {
                    lastError = error
                }
            }
            await MainActor.run {
                self.yandexBusy = false
                if uploaded == snapshot.count {
                    self.yandexStatus = "Выгружено: \(uploaded)"
                } else if let lastError {
                    let message = YandexDiskClient.userFacingMessage(for: lastError)
                    self.yandexStatus = message
                    if let disk = lastError as? YandexDiskError, disk == .http(401) || disk == .http(403) {
                        self.logoutYandex()
                        self.yandexStatus = message
                    }
                } else {
                    self.yandexStatus = "Выгружено \(uploaded) из \(snapshot.count)"
                }
            }
        }
    }
}
