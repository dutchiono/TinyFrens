import SwiftUI
import WebKit
import UIKit

@main
struct TinyFrensApp: App {
    var body: some Scene {
        WindowGroup { PetWebView().ignoresSafeArea(.container, edges: .bottom) }
    }
}

struct PetWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = false
        config.websiteDataStore = .default()
        config.userContentController.addUserScript(WKUserScript(
            source: "window.PetIOS = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(context.coordinator, name: "petUpdates")
        config.userContentController.add(context.coordinator, name: "petTurtle")
        let web = WKWebView(frame: .zero, configuration: config)
        context.coordinator.attach(web)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.96, green: 0.95, blue: 0.91, alpha: 1)
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
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, URLSessionTaskDelegate {
        weak var web: WKWebView?
        private var foregroundObserver: NSObjectProtocol?
        private var checking = false
        func attach(_ webView: WKWebView) {
            web = webView
            foregroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                self?.web?.evaluateJavaScript("window.onIOSResume?.()", completionHandler: nil)
            }
        }
        deinit { if let observer = foregroundObserver { NotificationCenter.default.removeObserver(observer) } }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame else { return }
            if message.name == "petTurtle" { turtleRequest(message); return }
            guard message.name == "petUpdates" else { return }
            if (message.body as? String) == "tap" { UIImpactFeedbackGenerator(style: .light).impactOccurred(); return }
            if (message.body as? String) == "check" { checkUpdates(); return }
            if let data = message.body as? [String: String], data["type"] == "share",
               let raw = data["url"], raw.count < 2200, let url = URL(string: raw),
               url.scheme == "https", url.host == "dutchiono.github.io", url.path == "/TinyFrens/web/" {
                let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = web
                sheet.popoverPresentationController?.sourceRect = web?.bounds ?? .zero
                let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
                var presenter = scene?.windows.first { $0.isKeyWindow }?.rootViewController
                while let presented = presenter?.presentedViewController { presenter = presented }
                presenter?.present(sheet, animated: true)
            }
        }
        private func turtleRequest(_ message: WKScriptMessage) {
            let paths: Set<String> = ["/api/register", "/api/wallet-link/status", "/api/wallet-link/challenge",
                "/api/wallet-link/confirm", "/api/wallet-link/disconnect", "/api/wallet-link/nfts", "/api/featured/hood-turtle",
                "/api/turtle-connect/start", "/api/turtle-connect/status", "/api/turtle-connect/accept"]
            guard let page = message.frameInfo.request.url, page.isFileURL,
                  let folder = Bundle.main.resourceURL?.appendingPathComponent("web"),
                  page.standardizedFileURL.path.hasPrefix(folder.standardizedFileURL.path + "/"),
                  let payload = message.body as? [String: Any], let id = payload["requestId"] as? Int,
                  payload["server"] as? String == "https://tinyfrens.miono.live",
                  let path = payload["path"] as? String, paths.contains(path),
                  let body = payload["body"] as? [String: Any],
                  let encoded = try? JSONSerialization.data(withJSONObject: body), encoded.count <= 4096,
                  let url = URL(string: "https://tinyfrens.miono.live" + path) else { return }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"; request.httpBody = encoded; request.timeoutInterval = 30
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("null", forHTTPHeaderField: "Origin")
            let session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)
            session.dataTask(with: request) { [weak self] data, response, error in
                defer { session.finishTasksAndInvalidate() }
                var result: [String: Any] = ["error": "Turtle connection unavailable. Please retry."]
                if error == nil, let data = data, data.count <= 2_000_000,
                   let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                    if (response as? HTTPURLResponse)?.statusCode == 200 { result = json }
                    else { result = ["error": json["error"] as? String ?? "Turtle connection failed."] }
                }
                guard let encoded = try? JSONSerialization.data(withJSONObject: ["requestId": id, "result": result]),
                      let json = String(data: encoded, encoding: .utf8) else { return }
                DispatchQueue.main.async { self?.web?.evaluateJavaScript("window.onTurtleResponse?.(\(json))", completionHandler: nil) }
            }.resume()
        }
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
        private func send(_ result: [String: Any]) {
            checking = false
            guard let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) else { return }
            web?.evaluateJavaScript("window.onIOSUpdate?.(\(json))", completionHandler: nil)
        }
        private func checkUpdates() {
            guard !checking else { return }
            checking = true
            guard let metadataURL = Bundle.main.resourceURL?.appendingPathComponent("web/build-info.json"),
                  let data = try? Data(contentsOf: metadataURL),
                  let info = (try? JSONSerialization.jsonObject(with: data)) as? [String: String],
                  let revision = info["revision"], !revision.isEmpty else {
                send(["error": "This local build has no update metadata."]); return
            }
            let installedDate = ISO8601DateFormatter().date(from: info["builtAt"] ?? "") ?? .distantPast
            // Desktop/Android-only releases must not hide the newest installable iPhone build.
            var request = URLRequest(url: URL(string: "https://api.github.com/repos/dutchiono/TinyFrens/releases?per_page=20")!)
            request.timeoutInterval = 15
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.setValue("TinyFrens", forHTTPHeaderField: "User-Agent")
            URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
                var result: [String: Any] = ["error": "Unable to check for updates."]
                if error == nil, (response as? HTTPURLResponse)?.statusCode == 200,
                   let data = data, let releases = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]],
                   let release = releases.first(where: { entry in
                       let assets = entry["assets"] as? [[String: Any]] ?? []
                       return assets.contains { ($0["name"] as? String) == "TinyFrens-unsigned.ipa" }
                   }) {
                    let latest = release["target_commitish"] as? String ?? ""
                    let created = ISO8601DateFormatter().date(from: release["created_at"] as? String ?? "") ?? .distantPast
                    let assets = release["assets"] as? [[String: Any]] ?? []
                    let hasIPA = assets.contains { ($0["name"] as? String) == "TinyFrens-unsigned.ipa" }
                    let available = hasIPA && latest != revision && latest.count == 40 && created > installedDate
                    result = ["available": available, "versionName": release["tag_name"] as? String ?? ""]
                }
                let finalResult = result
                DispatchQueue.main.async { self?.send(finalResult) }
            }.resume()
        }
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url, url.scheme == "https" { UIApplication.shared.open(url) }
            return nil
        }
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

