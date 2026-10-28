import Foundation
import FTPCore

#if canImport(Photos)
import Photos
#endif

enum PhotoLibraryImporter {
    static func save(_ file: IncomingFile) {
        #if canImport(Photos)
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else { return }
            PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                options.originalFilename = file.originalName
                switch file.kind {
                case .video:
                    request.addResource(with: .video, fileURL: file.storedURL, options: options)
                case .jpeg, .raw, .other:
                    request.addResource(with: .photo, fileURL: file.storedURL, options: options)
                }
            } completionHandler: { _, _ in }
        }
        #endif
    }
}
