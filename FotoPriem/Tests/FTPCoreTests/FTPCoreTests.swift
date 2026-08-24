import XCTest
@testable import FTPCore

final class AddressPickerTests: XCTestCase {
    func testCameraModePrefersNonHotspotWiFi() {
        let interfaces = [
            InterfaceIPv4(name: "bridge100", ip: "172.20.10.1"),
            InterfaceIPv4(name: "en0", ip: "192.168.0.14")
        ]
        XCTAssertEqual(
            AddressPicker.advertisedIP(interfaces: interfaces, scenario: .cameraAccessPoint),
            "192.168.0.14"
        )
    }

    func testHotspotModePrefersBridge() {
        let interfaces = [
            InterfaceIPv4(name: "en0", ip: "192.168.0.14"),
            InterfaceIPv4(name: "bridge100", ip: "172.20.10.1")
        ]
        XCTAssertEqual(
            AddressPicker.advertisedIP(interfaces: interfaces, scenario: .phoneHotspot),
            "172.20.10.1"
        )
    }

    func testYandexOnlyOnPhoneHotspot() {
        XCTAssertFalse(ConnectionScenario.cameraAccessPoint.yandexUploadAvailable)
        XCTAssertTrue(ConnectionScenario.phoneHotspot.yandexUploadAvailable)
    }
}

final class IncomingStoreTests: XCTestCase {
    func testSanitizeAndUniqueNames() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try IncomingStore(rootDirectory: dir)
        let first = try store.save(originalPath: "/DCIM/100CANON/IMG_0001.JPG", data: Data("a".utf8))
        let second = try store.save(originalPath: "/DCIM/100CANON/IMG_0001.JPG", data: Data("b".utf8))
        XCTAssertEqual(first.kind, .jpeg)
        XCTAssertEqual(first.originalName, "DCIM_100CANON_IMG_0001.JPG")
        XCTAssertNotEqual(first.storedURL.lastPathComponent, second.storedURL.lastPathComponent)
        XCTAssertEqual(store.allFiles().count, 2)
    }

    func testMediaKinds() {
        XCTAssertEqual(MediaKind.detect(fileName: "a.CR3"), .raw)
        XCTAssertEqual(MediaKind.detect(fileName: "b.NEF"), .raw)
        XCTAssertEqual(MediaKind.detect(fileName: "c.ARW"), .raw)
        XCTAssertEqual(MediaKind.detect(fileName: "d.DNG"), .raw)
        XCTAssertEqual(MediaKind.detect(fileName: "e.MP4"), .video)
        XCTAssertEqual(MediaKind.detect(fileName: "f.MOV"), .video)
        XCTAssertEqual(MediaKind.detect(fileName: "g.JPG"), .jpeg)
    }
}

final class FTPReceiveTests: XCTestCase {
    func testPassiveStorRoundTrip() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try IncomingStore(rootDirectory: dir)
        let port = UInt16.random(in: 21000...21999)
        let server = FTPServer(
            credentials: FTPCredentials(username: "foto", password: "priem", port: port),
            store: store
        )
        try server.start()
        defer { server.stop() }
        Thread.sleep(forTimeInterval: 0.2)

        let payload = Data("hello-from-camera".utf8)
        try FakeCameraFTP.upload(
            host: "127.0.0.1",
            port: port,
            user: "foto",
            password: "priem",
            fileName: "DSC_0001.JPG",
            payload: payload
        )

        let files = store.allFiles()
        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(files[0].kind, .jpeg)
        XCTAssertEqual(try Data(contentsOf: files[0].storedURL), payload)
    }
}
