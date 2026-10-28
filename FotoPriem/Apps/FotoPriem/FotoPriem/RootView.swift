import SwiftUI
import FTPCore

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ScenarioPickerView()
                    ServerPanelView()
                    YandexPanelView()
                    InboxListView()
                }
                .padding(20)
            }
            .background(Color(red: 0.07, green: 0.07, blue: 0.08).ignoresSafeArea())
            .navigationTitle("Фотоприём")
        }
    }
}
