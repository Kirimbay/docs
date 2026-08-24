import SwiftUI
import FTPCore

struct ScenarioPickerView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Сценарий съёмки")
                .font(.headline)
                .foregroundStyle(.white.opacity(0.9))

            ForEach(ConnectionScenario.allCases) { scenario in
                Button {
                    model.select(scenario)
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: scenario == .cameraAccessPoint ? "wifi" : "personalhotspot")
                            .font(.title2)
                            .frame(width: 36)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(scenario.title)
                                .font(.headline)
                            Text(scenario.subtitle)
                                .font(.subheadline)
                                .foregroundStyle(.white.opacity(0.7))
                            Text(instructions(for: scenario))
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.55))
                                .padding(.top, 2)
                        }
                        Spacer()
                        if model.scenario == scenario {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(Color.accentColor)
                        }
                    }
                    .padding(14)
                    .background(
                        RoundedRectangle(cornerRadius: 16)
                            .fill(Color.white.opacity(model.scenario == scenario ? 0.12 : 0.05))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(model.scenario == scenario ? Color.accentColor.opacity(0.8) : Color.white.opacity(0.08), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
            }
        }
    }

    private func instructions(for scenario: ConnectionScenario) -> String {
        switch scenario {
        case .cameraAccessPoint:
            return "1) Включи Wi‑Fi на камере. 2) На iPhone: Настройки → Wi‑Fi → сеть камеры. 3) Вернись сюда и запусти приём. В FTP камеры укажи IP ниже."
        case .phoneHotspot:
            return "1) Включи режим модема на iPhone. 2) Подключи камеру к этой сети. 3) Запусти приём. Яндекс Диск станет доступен."
        }
    }
}
