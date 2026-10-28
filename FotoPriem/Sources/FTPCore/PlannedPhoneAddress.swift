import Foundation

/// Address you type into the camera FTP wizard *before* the iPhone joins.
/// iOS cannot set this from the app; the user assigns it once in Wi-Fi settings.
public enum PlannedPhoneAddress {
    public static let cameraAccessPointIP = "192.168.1.20"
    public static let cameraGatewayIP = "192.168.1.1"
    public static let subnetMask = "255.255.255.0"
    public static let phoneHotspotIP = "172.20.10.1"

    public static func ftpTarget(for scenario: ConnectionScenario) -> String {
        switch scenario {
        case .cameraAccessPoint: return cameraAccessPointIP
        case .phoneHotspot: return phoneHotspotIP
        }
    }

    public static func currentMatchesPlan(_ current: String?, scenario: ConnectionScenario) -> Bool {
        guard let current else { return false }
        return current == ftpTarget(for: scenario)
    }
}
