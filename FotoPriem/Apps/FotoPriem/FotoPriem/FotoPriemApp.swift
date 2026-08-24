import SwiftUI
import FTPCore

@main
struct FotoPriemApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .onOpenURL { url in
                    model.handleOAuthRedirect(url)
                }
        }
    }
}
