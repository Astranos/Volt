import SwiftUI
import WebKit

struct PortalWebView: UIViewRepresentable {
    let policy: PortalNavigationPolicy
    @Binding var loadState: PortalLoadState
    let retryID: Int

    func makeCoordinator() -> Coordinator {
        Coordinator(policy: policy, loadState: $loadState, retryID: retryID)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.isInspectable = false
        webView.accessibilityIdentifier = "kioskPortal"
        webView.load(URLRequest(url: policy.portalURL, timeoutInterval: 30))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.loadState = $loadState
        if context.coordinator.retryID != retryID {
            context.coordinator.retryID = retryID
            webView.load(URLRequest(url: policy.portalURL, timeoutInterval: 30))
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let policy: PortalNavigationPolicy
        var loadState: Binding<PortalLoadState>
        var retryID: Int

        init(policy: PortalNavigationPolicy, loadState: Binding<PortalLoadState>, retryID: Int) {
            self.policy = policy
            self.loadState = loadState
            self.retryID = retryID
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard policy.allows(navigationAction.request.url), !navigationAction.shouldPerformDownload else {
                decisionHandler(.cancel)
                if navigationAction.targetFrame?.isMainFrame == true && loadState.wrappedValue == .loading {
                    loadState.wrappedValue = .failed
                }
                return
            }
            // Reuse the one portal view for target="_blank" and window.open links.
            if navigationAction.targetFrame == nil {
                decisionHandler(.cancel)
                webView.load(navigationAction.request)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            guard policy.allows(navigationResponse.response.url),
                  navigationResponse.canShowMIMEType,
                  (navigationResponse.response as? HTTPURLResponse).map({ (200..<400).contains($0.statusCode) }) == true,
                  (navigationResponse.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().hasPrefix("attachment") != true,
                  let mimeType = navigationResponse.response.mimeType,
                  ["text/html", "application/xhtml+xml"].contains(mimeType.lowercased()) else {
                decisionHandler(.cancel)
                if navigationResponse.isForMainFrame { loadState.wrappedValue = .failed }
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            loadState.wrappedValue = .loading
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loadState.wrappedValue = .ready
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            reportFailure(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            reportFailure(error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            loadState.wrappedValue = .loading
            webView.load(URLRequest(url: policy.portalURL, timeoutInterval: 30))
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            // Never create another browser window or hand a URL to another app.
            nil
        }

        func webView(_ webView: WKWebView, contextMenuConfigurationForElement elementInfo: WKContextMenuElementInfo, completionHandler: @escaping (UIContextMenuConfiguration?) -> Void) {
            completionHandler(nil)
        }

        private func reportFailure(_ error: Error) {
            let error = error as NSError
            guard !(error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled) else { return }
            loadState.wrappedValue = .failed
        }
    }
}
