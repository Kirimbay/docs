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

            TextField("Почта или логин Яндекса", text: $model.yandexLogin)
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
                .autocorrectionDisabled()
                .textFieldStylePlain()
                .onChange(of: model.yandexLogin) { _ in
                    model.saveYandexCredentials()
                }

            SecureField("Пароль", text: $model.yandexPassword)
                .textContentType(.password)
                .textFieldStylePlain()
                .onChange(of: model.yandexPassword) { _ in
                    model.saveYandexCredentials()
                }

            Text("Обычный пароль от Яндекса. Если включена двухфакторная защита — пароль приложения: id.yandex.ru → Безопасность.")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.45))

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

private extension View {
    func textFieldStylePlain() -> some View {
        self
            .padding(10)
            .background(Color.white.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .foregroundStyle(.white)
    }
}
