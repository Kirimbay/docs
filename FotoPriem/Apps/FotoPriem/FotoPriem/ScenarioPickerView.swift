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
            return "Камера сразу спросит FTP — пиши 192.168.1.20 и порт 2121. Потом на iPhone один раз поставь этот же IP вручную в настройках Wi‑Fi камеры."
        case .phoneHotspot:
            return "1) Режим модема на iPhone. 2) Камера в эту сеть. 3) В FTP камеры пиши 172.20.10.1 и порт 2121."
        }
    }
}
