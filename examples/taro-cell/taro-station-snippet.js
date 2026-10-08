// Paste into the taro-station cell page (once, e.g. before </body>). When the page is framed by the taro-cell plugin
// it reports its scroll position to the panel and follows the other pane; opened on its own it does nothing.
(() => {
  if (parent === window) return;
  let applying = false; // true while we scroll because of a message, so that scroll is not reported back
  const range = () => Math.max(0, document.documentElement.scrollHeight - innerHeight);
  addEventListener('scroll', () => {
    if (!applying) parent.postMessage({ type: 'taro-scroll', y: range() ? scrollY / range() : 0 }, '*');
  }, { passive: true });
  addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== parent || !d || d.type !== 'taro-scroll' || typeof d.y !== 'number') return;
    applying = true;
    scrollTo(scrollX, d.y * range());
    requestAnimationFrame(() => (applying = false)); // the scroll event fires before this frame's callbacks
  });
})();
