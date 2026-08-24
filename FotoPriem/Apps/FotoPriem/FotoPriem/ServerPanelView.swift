import SwiftUI

struct ServerPanelView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("FTP для камеры")
                .font(.headline)
                .foregroundStyle(.white.opacity(0.9))

            infoRow("IP", model.advertisedIP)
            infoRow("Порт", String(model.credentials.port))
            infoRow("Логин", model.credentials.username)
            infoRow("Пароль", model.credentials.password)
            infoRow("Статус", model.statusMessage)

            Text(model.scenario == .cameraAccessPoint
                 ? "На экране камеры «Адрес IP» — это адрес самой камеры (ставь 192.168.1.1 и маску 255.255.255.0). IP из приложения сюда не пишется. Он нужен позже, в меню FTP."
                 : "В FTP камеры укажи IP из этой карточки — обычно 172.20.10.1.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.65))

            if let error = model.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            Toggle("Не гасить экран во время приёма", isOn: $model.keepScreenOn)
                .tint(Color.accentColor)
                .foregroundStyle(.white)
                .onChange(of: model.keepScreenOn) { _ in
                    model.applyIdleTimer()
                }

            Button(action: model.toggleServer) {
                Text(model.isRunning ? "Остановить приём" : "Запустить приём")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(model.isRunning ? Color.red.opacity(0.85) : Color.accentColor)
                    .foregroundStyle(.black)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }

            Text("В настройках сети камеры выключи «Частный адрес Wi‑Fi», иначе IP может смениться.")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.45))
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18).fill(Color.white.opacity(0.05)))
    }

    private func infoRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(.white.opacity(0.55))
            Spacer()
            Text(value)
                .font(.body.monospaced())
                .foregroundStyle(.white)
                .textSelection(.enabled)
        }
        .font(.subheadline)
    }
}
