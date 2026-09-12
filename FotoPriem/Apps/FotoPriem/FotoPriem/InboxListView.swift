import SwiftUI
import FTPCore

struct InboxListView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Принято: \(model.files.count)")
                .font(.headline)
                .foregroundStyle(.white.opacity(0.9))

            if model.files.isEmpty {
                Text("Файлы с камеры появятся здесь и сразу уйдут в Фото.")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.5))
            } else {
                ForEach(model.files) { file in
                    HStack {
                        Text(file.kind.title)
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.accentColor.opacity(0.25))
                            .clipShape(Capsule())
                        VStack(alignment: .leading) {
                            Text(file.originalName)
                                .foregroundStyle(.white)
                                .lineLimit(1)
                            Text(byteLabel(file.byteCount))
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.5))
                        }
                        Spacer()
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18).fill(Color.white.opacity(0.05)))
    }

    private func byteLabel(_ count: Int) -> String {
        if count < 1024 { return "\(count) Б" }
        if count < 1024 * 1024 { return String(format: "%.1f КБ", Double(count) / 1024) }
        return String(format: "%.1f МБ", Double(count) / 1024 / 1024)
    }
}
