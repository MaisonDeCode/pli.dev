import SwiftUI
import WebKit

/// The document as `document.html()` writes it, in a web view: bold, lists with their styles, tables and the rest.
struct PreviewView: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        WKWebView()
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let page = """
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font: -apple-system-body; font-family: -apple-system, sans-serif; margin: 16px; line-height: 1.45; }
          table { border-collapse: collapse; } td, th { border: 1px solid #bbb; padding: 4px 8px; }
          @media (prefers-color-scheme: dark) { body { background: #000; color: #eee; } td, th { border-color: #555; } }
        </style>
        \(html)
        """
        view.loadHTMLString(page, baseURL: nil)
    }
}
