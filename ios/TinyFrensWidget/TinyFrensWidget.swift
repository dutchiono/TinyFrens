import WidgetKit
import SwiftUI

struct FrenEntry: TimelineEntry { let date: Date }
struct FrenProvider: TimelineProvider {
    func placeholder(in context: Context) -> FrenEntry { FrenEntry(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (FrenEntry) -> Void) { completion(FrenEntry(date: Date())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<FrenEntry>) -> Void) {
        completion(Timeline(entries: [FrenEntry(date: Date())], policy: .never))
    }
}
struct FrenWidgetView: View {
    var entry: FrenEntry
    var body: some View {
        ZStack {
            Color(red: 0.09, green: 0.07, blue: 0.17)
            VStack(spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: 6).fill(Color.purple).frame(width: 62, height: 54)
                    VStack(spacing: 10) {
                        HStack(spacing: 18) {
                            RoundedRectangle(cornerRadius: 2).fill(Color.black).frame(width: 10, height: 12)
                            RoundedRectangle(cornerRadius: 2).fill(Color.black).frame(width: 10, height: 12)
                        }
                        Rectangle().fill(Color.black).frame(width: 18, height: 3)
                    }
                    Rectangle().fill(Color.purple).frame(width: 4, height: 12).offset(y: -33)
                    HStack(spacing: 24) {
                        Rectangle().fill(Color.purple).frame(width: 10, height: 9)
                        Rectangle().fill(Color.purple).frame(width: 10, height: 9)
                    }.offset(y: 30)
                }.frame(width: 76, height: 76).accessibilityLabel("TinyFrens simple robot")
                Text("Hey, fren!").font(.headline).foregroundColor(.white)
                Text("Tap to play").font(.caption).foregroundColor(.white.opacity(0.8))
            }.padding()
        }.widgetURL(URL(string: "tinyfrens://pet"))
    }
}
@main
struct TinyFrensWidget: Widget {
    let kind = "TinyFrensHello"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FrenProvider()) { entry in
            if #available(iOSApplicationExtension 17.0, *) {
                FrenWidgetView(entry: entry).containerBackground(for: .widget) { Color(red: 0.09, green: 0.07, blue: 0.17) }
            } else { FrenWidgetView(entry: entry) }
        }
        .configurationDisplayName("TinyFrens")
        .description("A friendly hello. Tap to open your pet.")
        .supportedFamilies([.systemSmall])
    }
}

