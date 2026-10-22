// The preview <webview> blocks popups (no `allowpopups`), so a link with
// target="_blank" or a window.open() call would do nothing. This script is
// injected into each preview page and turns both into a normal navigation.
// The plugin's existing will-navigate handling then takes over: links into
// the site open that note in the editor, and external http(s)/mailto links
// open in the system browser. No Node or Obsidian imports here, so the
// script can be tested against a fake page.

export const BLANK_LINK_SCRIPT = `(function () {
  if (window.__inkstoneBlankLinks) return;
  window.__inkstoneBlankLinks = true;
  var ALLOWED = /^(https?:|mailto:)/i;
  function go(url) {
    var abs;
    try {
      abs = new URL(url, window.location.href).href;
    } catch (e) {
      return;
    }
    if (ALLOWED.test(abs)) window.location.href = abs;
  }
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented) return;
    var el = e.target;
    var a = el && el.closest ? el.closest("a[target]") : null;
    if (!a) return;
    var t = (a.getAttribute("target") || "").toLowerCase();
    if (t === "" || t === "_self" || t === "_parent" || t === "_top") return;
    var href = a.getAttribute("href");
    if (!href) return;
    e.preventDefault();
    go(href);
  }, true);
  window.open = function (url) {
    if (url) go(String(url));
    return null;
  };
})();`;
