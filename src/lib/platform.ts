// WKWebView reports "Macintosh" in its user agent; WebView2 reports "Windows".
export const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
