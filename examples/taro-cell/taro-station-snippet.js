// Paste into the taro-station cell page (once, e.g. before </body>). When the page is framed by the taro-cell plugin
// it reports its scroll position to the panel and follows the other pane; opened on its own, or framed by anything
// else, it does nothing.
(() => {
  if (parent === window) return;
  // The origin of a VS Code webview: desktop, or the web/remote editors.
  const VSCODE = /^(vscode-webview:\/\/[^/]+|https:\/\/[^/]+\.vscode-cdn\.net)$/;
  let peer = ''; // the panel's origin, learned from its greeting; nothing is reported before that
  let applying = false; // true while we scroll because of a message, so that scroll is not reported back
  const range = () => Math.max(0, document.documentElement.scrollHeight - innerHeight);
  addEventListener('scroll', () => {
    if (peer && !applying) parent.postMessage({ type: 'taro-scroll', y: range() ? scrollY / range() : 0 }, peer);
  }, { passive: true });
  addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== parent || !VSCODE.test(e.origin) || !d) return;
    if (d.type === 'taro-hello') peer = e.origin;
    else if (d.type === 'taro-scroll' && peer === e.origin && typeof d.y === 'number') {
      applying = true;
      scrollTo(scrollX, d.y * range());
      requestAnimationFrame(() => (applying = false)); // the scroll event fires before this frame's callbacks
    }
  });
})();
