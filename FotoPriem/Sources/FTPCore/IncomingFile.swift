import Foundation

public struct IncomingFile: Codable, Equatable, Sendable, Identifiable {
    public var id: UUID
    public var originalName: String
    public var storedURL: URL
    public var byteCount: Int
    public var kind: MediaKind
    public var receivedAt: Date

    public init(
        id: UUID = UUID(),
        originalName: String,
        storedURL: URL,
        byteCount: Int,
        kind: MediaKind,
        receivedAt: Date = Date()
    ) {
        self.id = id
        self.originalName = originalName
        self.storedURL = storedURL
        self.byteCount = byteCount
        self.kind = kind
        self.receivedAt = receivedAt
    }
}
