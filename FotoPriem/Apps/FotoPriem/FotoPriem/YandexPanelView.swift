import SwiftUI

struct YandexPanelView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Яндекс Диск")
                .font(.headline)
                .foregroundStyle(.white.opacity(0.9))

            Text(model.yandexButtonReason)
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.65))

            TextField("Client ID приложения Яндекса", text: $model.yandexClientID)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(10)
                .background(Color.white.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .foregroundStyle(.white)
                .onChange(of: model.yandexClientID) { _ in
                    model.saveClientID()
                }

            HStack {
                if let url = model.yandexAuthURL() {
                    Link("Войти в Яндекс", destination: url)
                        .buttonStyle(.bordered)
                } else {
                    Text("Создай приложение на oauth.yandex.ru и вставь Client ID")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.5))
                }
                Spacer()
            }

            Text(model.yandexStatus)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.6))

            Button(action: model.uploadToYandex) {
                Text(model.yandexBusy ? "Выгрузка…" : "Выгрузить в Яндекс Диск")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(model.yandexButtonEnabled ? Color.accentColor : Color.white.opacity(0.15))
                    .foregroundStyle(model.yandexButtonEnabled ? .black : .white.opacity(0.4))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .disabled(!model.yandexButtonEnabled)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18).fill(Color.white.opacity(0.05)))
        .opacity(model.scenario.yandexUploadAvailable ? 1 : 0.55)
    }
}
