import Foundation

public final class IncomingStore: @unchecked Sendable {
    public let rootDirectory: URL
    private let lock = NSLock()
    private var files: [IncomingFile] = []
    private var observers: [(IncomingFile) -> Void] = []

    public init(rootDirectory: URL) throws {
        self.rootDirectory = rootDirectory
        try FileManager.default.createDirectory(at: rootDirectory, withIntermediateDirectories: true)
    }

    public func allFiles() -> [IncomingFile] {
        lock.lock()
        defer { lock.unlock() }
        return files
    }

    public func onFile(_ handler: @escaping (IncomingFile) -> Void) {
        lock.lock()
        observers.append(handler)
        lock.unlock()
    }

    /// Writes incoming FTP payload. Duplicate names get a numeric suffix — nothing is skipped.
    public func save(originalPath: String, data: Data) throws -> IncomingFile {
        let sanitized = Self.sanitize(originalPath)
        let kind = MediaKind.detect(fileName: sanitized)
        let day = Self.dayFormatter.string(from: Date())
        let folder = rootDirectory.appendingPathComponent(day, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        let uniqueURL = Self.uniqueURL(in: folder, preferredName: sanitized)
        try data.write(to: uniqueURL, options: .atomic)

        let file = IncomingFile(
            originalName: sanitized,
            storedURL: uniqueURL,
            byteCount: data.count,
            kind: kind
        )

        var handlers: [(IncomingFile) -> Void] = []
        lock.lock()
        files.insert(file, at: 0)
        handlers = observers
        lock.unlock()
        handlers.forEach { $0(file) }
        return file
    }

    public static func sanitize(_ path: String) -> String {
        var name = path.replacingOccurrences(of: "\\", with: "/")
        while name.hasPrefix("/") { name.removeFirst() }
        let parts = name.split(separator: "/").map(String.init).filter { $0 != "." && $0 != ".." && !$0.isEmpty }
        let joined = parts.joined(separator: "_")
        return joined.isEmpty ? "unnamed.bin" : joined
    }

    static func uniqueURL(in folder: URL, preferredName: String) -> URL {
        let base = (preferredName as NSString).deletingPathExtension
        let ext = (preferredName as NSString).pathExtension
        var candidate = folder.appendingPathComponent(preferredName)
        var index = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            let next = ext.isEmpty ? "\(base)_\(index)" : "\(base)_\(index).\(ext)"
            candidate = folder.appendingPathComponent(next)
            index += 1
        }
        return candidate
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}
