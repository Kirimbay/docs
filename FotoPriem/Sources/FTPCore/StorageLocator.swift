import Foundation

/// Picks a writable folder. Never uses Documents/Inbox — iOS reserves that name
/// and createDirectory fails with "no permission to save Inbox".
public enum StorageLocator {
    public static func writableRoot(named folder: String = "FotoPriemReceived") throws -> URL {
        precondition(folder.caseInsensitiveCompare("Inbox") != .orderedSame)

        let fm = FileManager.default
        var bases: [URL] = []
        bases.append(contentsOf: fm.urls(for: .applicationSupportDirectory, in: .userDomainMask))
        bases.append(contentsOf: fm.urls(for: .documentDirectory, in: .userDomainMask))
        bases.append(fm.temporaryDirectory)

        var lastError: Error?
        for base in bases {
            if base.lastPathComponent == "Inbox" { continue }
            let url = base.appendingPathComponent(folder, isDirectory: true)
            do {
                try fm.createDirectory(at: url, withIntermediateDirectories: true)
                let probe = url.appendingPathComponent(".write-test-\(UUID().uuidString)")
                try Data("ok".utf8).write(to: probe, options: .atomic)
                try fm.removeItem(at: probe)
                return url
            } catch {
                lastError = error
            }
        }

        throw lastError ?? NSError(domain: NSCocoaErrorDomain, code: 513)
    }

    public static func userFacingMessage(for error: Error) -> String {
        let ns = error as NSError
        if ns.domain == NSCocoaErrorDomain && (ns.code == 513 || ns.code == 257 || ns.code == 642) {
            return "Не удалось создать папку для снимков. Удали приложение и поставь его снова через Xcode."
        }
        return "Не удалось запустить приём: \(error.localizedDescription)"
    }
}
