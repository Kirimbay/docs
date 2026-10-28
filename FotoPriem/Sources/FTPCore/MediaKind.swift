import Foundation

public enum MediaKind: String, Codable, Sendable, CaseIterable {
    case jpeg
    case raw
    case video
    case other

    public var title: String {
        switch self {
        case .jpeg: return "JPEG"
        case .raw: return "RAW"
        case .video: return "Видео"
        case .other: return "Файл"
        }
    }

    public static func detect(fileName: String) -> MediaKind {
        let ext = (fileName as NSString).pathExtension.lowercased()
        if jpegExtensions.contains(ext) { return .jpeg }
        if rawExtensions.contains(ext) { return .raw }
        if videoExtensions.contains(ext) { return .video }
        return .other
    }

    public static let jpegExtensions: Set<String> = [
        "jpg", "jpeg", "png", "heic", "heif", "tif", "tiff", "webp", "bmp"
    ]

    public static let rawExtensions: Set<String> = [
        "dng", "cr2", "cr3", "nef", "nrw", "arw", "srf", "sr2",
        "orf", "raf", "rw2", "raw", "rwl", "pef", "ptx",
        "3fr", "fff", "mef", "mos", "kdc", "dcr", "erf", "x3f"
    ]

    public static let videoExtensions: Set<String> = [
        "mp4", "mov", "m4v", "avi", "mpg", "mpeg", "mts", "m2ts", "mkv"
    ]
}
