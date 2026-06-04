// Offscreen document — runs in the extension origin, so fetch() to
// ssrweb.zoom.us is covered by the extension's host_permissions and bypasses
// CORS entirely (the same context that made the diagnostic download-probe
// return 206 video). The in-page fetch failed because a normal web page is
// subject to CORS; here we are not.
//
// Flow: the service worker sends us the signed MP4 URL; we fetch it, build a
// Blob, and hand back a blob: URL. The worker then saves it via
// chrome.downloads (a clean blob: URL — nothing for Chrome to mangle). We keep
// the Blob alive until the worker tells us the download finished, then revoke.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'mh-offscreen-fetch' && msg.url) {
    (async () => {
      try {
        const r = await fetch(msg.url, { credentials: 'include', cache: 'no-store' });
        if (!r.ok) { sendResponse({ error: 'http_' + r.status }); return; }
        const blob = await r.blob();
        const blobUrl = URL.createObjectURL(blob);
        sendResponse({ ok: true, blobUrl, size: blob.size, mime: blob.type });
      } catch (e) {
        sendResponse({ error: String((e && e.message) || e) });
      }
    })();
    return true; // async sendResponse
  }
  if (msg?.type === 'mh-offscreen-revoke' && msg.blobUrl) {
    try { URL.revokeObjectURL(msg.blobUrl); } catch {}
  }
});
