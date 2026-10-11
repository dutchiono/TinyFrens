import SwiftUI
import WebKit

@main
struct TinyFrensApp: App {
    var body: some Scene {
        WindowGroup { PetWebView().ignoresSafeArea(.container, edges: .bottom) }
    }
}

struct PetWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.addUserScript(WKUserScript(
            source: "window.PetIOS = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.09, green: 0.08, blue: 0.16, alpha: 1)
        if let folder = Bundle.main.resourceURL?.appendingPathComponent("web"),
           FileManager.default.fileExists(atPath: folder.appendingPathComponent("index.html").path) {
            web.loadFileURL(folder.appendingPathComponent("index.html"), allowingReadAccessTo: folder)
        } else {
            web.loadHTMLString("<h1>TinyFrens</h1><p>Bundled pet assets are missing.</p>", baseURL: nil)
        }
        return web
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.isFileURL || url.scheme == "about" { decisionHandler(.allow) }
            else {
                if url.scheme == "https" { UIApplication.shared.open(url) }
                decisionHandler(.cancel)
            }
        }
    }
}
