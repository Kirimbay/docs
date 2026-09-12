import Foundation

/// Two field workflows the photographer actually uses.
public enum ConnectionScenario: String, Codable, CaseIterable, Sendable, Identifiable {
    /// No cellular / no internet. Camera creates Wi-Fi, iPhone joins it.
    case cameraAccessPoint = "cameraAccessPoint"
    /// Cellular is available. iPhone hotspot, camera joins the phone.
    case phoneHotspot = "phoneHotspot"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .cameraAccessPoint: return "Нет связи"
        case .phoneHotspot: return "Есть связь"
        }
    }

    public var subtitle: String {
        switch self {
        case .cameraAccessPoint:
            return "Камера раздаёт Wi‑Fi, iPhone подключается к ней"
        case .phoneHotspot:
            return "iPhone — точка доступа, камера подключается к телефону"
        }
    }

    /// Yandex Disk only makes sense when the phone can reach the internet.
    public var yandexUploadAvailable: Bool {
        self == .phoneHotspot
    }
}
