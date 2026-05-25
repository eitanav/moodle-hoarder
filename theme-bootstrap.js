// Synchronous theme application — runs before CSS parses to avoid a flash.
// MV3 forbids inline scripts under the default CSP (script-src 'self'), so
// this lives in its own file referenced from popup.html / options.html.
// settings.js mirrors theme changes to localStorage so the next page open
// can apply the right class immediately.
(function () {
  try {
    var t = localStorage.getItem('mh-theme');
    if (t === 'dark') document.documentElement.classList.add('mh-theme-dark');
    else if (t === 'light') document.documentElement.classList.add('mh-theme-light');
    var a = localStorage.getItem('mh-accent');
    if (a === 'blue-ariel') document.documentElement.classList.add('mh-accent-blue');
  } catch (e) {}
})();
