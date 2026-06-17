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
        const r = await fetch(msg.url, { credentials: 'include', cache: 'no-store', headers: { Range: 'bytes=0-' } });
        if (!r.ok) { sendResponse({ error: 'http_' + r.status }); return; }
        const blob = await r.blob();
        const blobUrl = URL.createObjectURL(blob);
        // Safety backstop: free the blob after 30 min in case the worker never
        // sends an explicit revoke (e.g. the anchor-fallback path).
        setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch {} }, 30 * 60 * 1000);
        sendResponse({ ok: true, blobUrl, size: blob.size, mime: blob.type });
      } catch (e) {
        sendResponse({ error: String((e && e.message) || e) });
      }
    })();
    return true; // async sendResponse
  }

  // Service workers do not expose URL.createObjectURL. Build transcript ZIPs
  // here (a real extension document), create a blob: URL, and let the worker
  // save/revoke it after chrome.downloads has consumed it.
  if (msg?.type === 'mh-offscreen-build-zip' && Array.isArray(msg.files)) {
    (async () => {
      try {
        if (typeof buildZip !== 'function') throw new Error('buildZip is unavailable in offscreen document');
        const files = msg.files.map((f) => ({
          path: String(f.path || 'file.txt'),
          blob: new Blob([String(f.text || '')], { type: f.type || 'text/plain;charset=utf-8' }),
        }));
        const blob = await buildZip(files);
        const blobUrl = URL.createObjectURL(blob);
        setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch {} }, 30 * 60 * 1000);
        sendResponse({ ok: true, blobUrl, size: blob.size, mime: blob.type });
      } catch (e) {
        sendResponse({ error: String((e && e.message) || e) });
      }
    })();
    return true;
  }

  if (msg?.type === 'mh-offscreen-revoke' && msg.blobUrl) {
    try { URL.revokeObjectURL(msg.blobUrl); } catch {}
  }
  // Fallback: download the already-created blob via an <a download> click in
  // the offscreen document (used if chrome.downloads can't read the blob URL
  // from the worker context).
  if (msg?.type === 'mh-offscreen-anchor' && msg.blobUrl) {
    try {
      const a = document.createElement('a');
      a.href = msg.blobUrl;
      a.download = msg.filename || 'recording.mp4';
      document.body.appendChild(a);
      a.click();
      a.remove();
      sendResponse?.({ ok: true });
    } catch (e) {
      sendResponse?.({ error: String((e && e.message) || e) });
    }
    return true;
  }
});
