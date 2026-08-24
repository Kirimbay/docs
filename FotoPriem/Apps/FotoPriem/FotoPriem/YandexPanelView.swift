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

            if !model.hasYandexClientID {
                Text("Один раз для автора приложения, пользователи это не делают: oauth.yandex.ru → твоё приложение → «Подставить URL для разработки» и права на Яндекс Диск. Сюда вставь ClientID.")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.55))
                TextField("ClientID приложения на oauth.yandex.ru", text: $model.yandexClientID)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(10)
                    .background(Color.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(.white)
                    .onChange(of: model.yandexClientID) { _ in
                        model.saveYandexClientID()
                    }
            }

            Text(model.yandexStatus)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.6))

            Button(action: model.uploadToYandex) {
                Text(model.yandexBusy ? "Выгрузка…" : (model.isYandexLoggedIn ? "Выгрузить в Яндекс Диск" : "Войти в Яндекс и выгрузить"))
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(model.yandexButtonEnabled ? Color.accentColor : Color.white.opacity(0.15))
                    .foregroundStyle(model.yandexButtonEnabled ? .black : .white.opacity(0.4))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .disabled(!model.yandexButtonEnabled)

            if model.isYandexLoggedIn {
                Button("Выйти из Яндекса", action: model.logoutYandex)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.55))
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18).fill(Color.white.opacity(0.05)))
        .opacity(model.scenario.yandexUploadAvailable ? 1 : 0.55)
        .sheet(isPresented: $model.showYandexLogin) {
            YandexLoginView(
                clientID: model.resolvedYandexClientID,
                onToken: { token in
                    model.finishYandexLogin(token: token)
                },
                onCancel: {
                    model.showYandexLogin = false
                    model.yandexBusy = false
                    model.yandexStatus = "Вход отменён"
                }
            )
        }
    }
}
