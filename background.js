// Context-menu: right-click any link on Moodle/Ariel → hoard it.
// The visible menu items now follow settings.rightClickBehavior:
//   'immediate' → one item: "הורד עם Moodle Hoarder"  (downloads now)
//   'queue'     → one item: "הוסף לתור Moodle Hoarder" (always queues)
//   'ask'       → two items: download-now + add-to-queue (user picks each time)

importScripts('settings.js');

const QUEUE_KEY = 'rightClickQueue';
const PATTERNS = ['*://moodlearn.ariel.ac.il/*', '*://*.ariel.ac.il/*'];

async function rebuildContextMenus() {
  const settings = await getSettings();
  const behavior = settings.rightClickBehavior || 'immediate';
  await new Promise(res => chrome.contextMenus.removeAll(res));

  // 'hoard-link' = the primary item; behavior decided by `behavior`
  // 'hoard-link-queue' = explicit queue (only shown for 'ask' mode)
  if (behavior === 'queue') {
    chrome.contextMenus.create({
      id: 'hoard-link',
      title: 'הוסף לתור Moodle Hoarder',
      contexts: ['link'],
      documentUrlPatterns: PATTERNS,
    });
  } else if (behavior === 'ask') {
    chrome.contextMenus.create({
      id: 'hoard-link',
      title: 'הורד מיד עם Moodle Hoarder',
      contexts: ['link'],
      documentUrlPatterns: PATTERNS,
    });
    chrome.contextMenus.create({
      id: 'hoard-link-queue',
      title: 'הוסף לתור Moodle Hoarder',
      contexts: ['link'],
      documentUrlPatterns: PATTERNS,
    });
  } else {
    // 'immediate' (default)
    chrome.contextMenus.create({
      id: 'hoard-link',
      title: 'הורד עם Moodle Hoarder',
      contexts: ['link'],
      documentUrlPatterns: PATTERNS,
    });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await rebuildContextMenus();
  updateBadge();
});

chrome.runtime.onStartup?.addListener(async () => {
  await rebuildContextMenus();
  updateBadge();
});

// Whenever the user changes settings (in options.html), rebuild the menu so
// they see the right item immediately on next right-click.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    const before = changes.settings.oldValue?.rightClickBehavior || 'immediate';
    const after = changes.settings.newValue?.rightClickBehavior || 'immediate';
    if (before !== after) rebuildContextMenus();
  }
  if (changes[QUEUE_KEY]) updateBadge();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.linkUrl) return;
  const url = resolveMoodleUrl(info.linkUrl);
  const settings = await getSettings();
  const behavior = settings.rightClickBehavior || 'immediate';

  // Explicit "add to queue" menu always queues.
  if (info.menuItemId === 'hoard-link-queue') {
    await pushQueue({ url, linkText: info.selectionText || '', pageUrl: tab?.url });
    return;
  }
  if (info.menuItemId !== 'hoard-link') return;

  // The primary item's action depends on the setting:
  if (behavior === 'queue') {
    await pushQueue({ url, linkText: info.selectionText || '', pageUrl: tab?.url });
    return;
  }
  // 'immediate' and 'ask' (with the immediate menu item picked) both download.
  try {
    await chrome.downloads.download({ url, saveAs: !!settings.rightClickSaveAs });
  } catch (e) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'Moodle Hoarder',
      message: 'שגיאת הורדה: ' + (e.message || e),
    });
  }
});

async function pushQueue(entry) {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = stored[QUEUE_KEY] || [];
  queue.push({ ...entry, addedAt: Date.now() });
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
  await updateBadge();
}

async function updateBadge() {
  try {
    const stored = await chrome.storage.local.get(QUEUE_KEY);
    const n = (stored[QUEUE_KEY] || []).length;
    await chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
    if (n > 0) await chrome.action.setBadgeBackgroundColor({ color: '#dc2867' });
  } catch {}
}

// Allow popup/options to ask us to refresh the badge after they touch the queue.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'refreshBadge') {
    updateBadge().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ========== Deep Zoom research (runs in the service worker) ==========
// Driven by a message from the popup. Runs in the worker — not the popup —
// so opening a focused tab (which closes the popup) doesn't kill the run.
// Records every browser-level network request via chrome.debugger while the
// recording plays, including the request the <video> element makes for the
// MP4 (invisible to fetch/XHR patches). Stores + downloads + notifies.

function _dbgSend(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (res) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message)); else resolve(res);
    });
  });
}
function _dbgAttach(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message)); else resolve();
    });
  });
}
function _dbgDetach(tabId) {
  return new Promise((resolve) => { try { chrome.debugger.detach({ tabId }, () => { void chrome.runtime.lastError; resolve(); }); } catch { resolve(); } });
}
function _pickHeaders(h) {
  if (!h) return {};
  const keep = ['referer', 'origin', 'cookie', 'range', 'authorization', 'user-agent', 'host', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'accept', 'content-type', 'content-length', 'content-range', 'content-disposition', 'location', 'access-control-allow-origin', 'cache-control', 'server', 'set-cookie'];
  const out = {};
  for (const k of Object.keys(h)) {
    const lk = k.toLowerCase();
    if (!keep.includes(lk)) continue;
    if (lk === 'cookie') out[lk] = h[k].split(';').map(c => c.split('=')[0].trim()).join('; ') + '  [values redacted]';
    else if (lk === 'set-cookie') out[lk] = '[present, redacted]';
    else out[lk] = h[k];
  }
  return out;
}

async function deepZoomResearch(shareUrl) {
  const t0 = Date.now();
  const report = {
    schema: 'moodle-hoarder.zoom-deep-research.v1',
    version: chrome.runtime.getManifest?.().version || '?',
    startedAt: new Date().toISOString(),
    shareUrl,
    requests: [],
    summary: {},
  };
  const byId = {};
  let tabId = null;
  const onEvent = (source, method, params) => {
    if (!tabId || source.tabId !== tabId) return;
    try {
      if (method === 'Network.requestWillBeSent') {
        const r = byId[params.requestId] = byId[params.requestId] || {};
        r.url = params.request.url; r.method = params.request.method;
        r.requestHeaders = _pickHeaders(params.request.headers); r.resourceType = params.type;
        if (params.redirectResponse) r.redirectFrom = { status: params.redirectResponse.status, location: params.redirectResponse.headers?.location };
      } else if (method === 'Network.responseReceived') {
        const r = byId[params.requestId] = byId[params.requestId] || {};
        r.status = params.response.status; r.statusText = params.response.statusText;
        r.mimeType = params.response.mimeType; r.responseHeaders = _pickHeaders(params.response.headers);
        r.remoteIP = params.response.remoteIPAddress; r.fromCache = params.response.fromDiskCache;
      } else if (method === 'Network.loadingFinished') {
        const r = byId[params.requestId]; if (r) r.bytes = params.encodedDataLength;
      } else if (method === 'Network.loadingFailed') {
        const r = byId[params.requestId] = byId[params.requestId] || {};
        r.failed = params.errorText; r.blockedReason = params.blockedReason;
      }
    } catch {}
  };
  try {
    const tab = await chrome.tabs.create({ url: shareUrl, active: true });
    tabId = tab.id;
    await new Promise(r => setTimeout(r, 1200));
    await _dbgAttach(tabId);
    chrome.debugger.onEvent.addListener(onEvent);
    await _dbgSend(tabId, 'Network.enable');
    await new Promise(r => setTimeout(r, 3500));
    try {
      await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN',
        func: () => {
          const sels = ['.play-control', '.zm-control-button-play', 'button.play-button', '[aria-label="Play" i]', '[aria-label="הפעל" i]', '[title="Play" i]', '.center-play-btn', '.vjs-play-control', '.lti-recording-item-play-media', '[class*="play-media"]', 'div[role="button"][aria-label*="play" i]'];
          for (const s of sels) { const el = document.querySelector(s); if (el && !el.disabled) { try { el.click(); return s; } catch {} } }
          for (const b of document.querySelectorAll('button')) { const tx = (b.textContent || '').trim().toLowerCase(); if (tx === 'play' || tx === 'הפעל') { try { b.click(); return 'btn-text'; } catch {} } }
          for (const v of document.querySelectorAll('video')) { try { v.play?.(); } catch {} }
          return null;
        },
      });
    } catch {}
    const CAP = 22000, start = Date.now();
    while (Date.now() - start < CAP) {
      await new Promise(r => setTimeout(r, 1500));
      try { await chrome.action.setBadgeText({ text: '🔬' }); } catch {}
    }
    try {
      const [{ result: pageState }] = await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN',
        func: () => ({
          finalUrl: location.href, title: document.title,
          videos: [...document.querySelectorAll('video')].map(v => ({ src: v.currentSrc || v.src || v.getAttribute('src') || '', readyState: v.readyState, error: v.error?.code || null, duration: v.duration })),
          sources: [...document.querySelectorAll('source')].map(s => s.src || s.getAttribute('src') || ''),
        }),
      });
      report.pageState = pageState;
    } catch (e) { report.pageState = { error: String(e) }; }
    const interesting = Object.entries(byId).filter(([, r]) =>
      /ssrweb\.zoom\.us|\.mp4|\.m3u8|\/rec\/|nws\.zoom/i.test(r.url || '') || (r.status && r.status >= 400) || /text\/html|json/i.test(r.mimeType || ''));
    for (const [id, r] of interesting) {
      const isMedia = /video|mpegurl|octet-stream/i.test(r.mimeType || '') || (r.bytes || 0) > 200000;
      if (isMedia) continue;
      try { const body = await _dbgSend(tabId, 'Network.getResponseBody', { requestId: id }); r.bodySnippet = body.base64Encoded ? '[base64 binary]' : (body.body || '').slice(0, 800); } catch {}
    }
    const all = Object.values(byId);
    report.requests = all.map(r => ({
      url: (r.url || '').slice(0, 4000), method: r.method, resourceType: r.resourceType,
      status: r.status, statusText: r.statusText, mimeType: r.mimeType, bytes: r.bytes,
      failed: r.failed, blockedReason: r.blockedReason, redirectFrom: r.redirectFrom, remoteIP: r.remoteIP,
      requestHeaders: r.requestHeaders, responseHeaders: r.responseHeaders, bodySnippet: r.bodySnippet,
    }));
    const isVid = (r) => /video|octet-stream/i.test(r.mimeType || '') || /\.mp4/i.test(r.url || '');
    report.summary.totalRequests = all.length;
    report.summary.mediaRequests = report.requests.filter(isVid);
    report.summary.ssrwebRequests = report.requests.filter(r => /ssrweb\.zoom\.us/i.test(r.url || ''));
    report.summary.hlsRequests = report.requests.filter(r => /\.m3u8/i.test(r.url || ''));
    report.summary.errorRequests = report.requests.filter(r => (r.status && r.status >= 400) || r.failed);
    const okMedia = report.summary.mediaRequests.find(r => r.status >= 200 && r.status < 300 && (r.bytes || 0) > 100000);
    report.summary.foundPlayingMediaUrl = okMedia ? okMedia.url : null;
    report.summary.mediaRequestHeaders = okMedia ? okMedia.requestHeaders : (report.summary.mediaRequests[0]?.requestHeaders || null);
    report.summary.elapsedMs = Date.now() - t0;
  } catch (e) {
    report.fatalError = String(e);
    report.hint = /Cannot access|Another debugger|already attached|Debugger is not allowed|Cannot attach/i.test(String(e))
      ? 'ודא שאין DevTools פתוח על הטאב, ושנתת הרשאת debugger (טען מחדש את התוסף).' : undefined;
  } finally {
    try { chrome.debugger.onEvent.removeListener(onEvent); } catch {}
    if (tabId) { await _dbgDetach(tabId); try { await chrome.tabs.remove(tabId); } catch {} }
    try { await chrome.action.setBadgeText({ text: '' }); } catch {}
  }
  return report;
}

// Popup → worker: run the deep research, then store + download + notify.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'mh-deep-research' || !msg.shareUrl) return;
  (async () => {
    await chrome.storage.local.set({ mhLastResearch: { status: 'running', startedAt: Date.now() } });
    let report;
    try { report = await deepZoomResearch(msg.shareUrl); }
    catch (e) { report = { schema: 'moodle-hoarder.zoom-deep-research.v1', fatalError: String(e) }; }
    const json = JSON.stringify(report, null, 2);
    const foundPlayingMediaUrl = report?.summary?.foundPlayingMediaUrl || null;
    await chrome.storage.local.set({ mhLastResearch: { status: 'done', at: Date.now(), foundPlayingMediaUrl, json } });
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await chrome.downloads.download({ url: 'data:application/json;charset=utf-8,' + encodeURIComponent(json), filename: `zoom-deep-research_${stamp}.json`, saveAs: false });
    } catch (e) { console.warn('[MH] research download failed', e); }
    try {
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icons/icon-128.png', title: 'Moodle Hoarder — מחקר Zoom',
        message: (report?.fatalError ? 'שגיאה: ' + report.fatalError : (foundPlayingMediaUrl ? '✅ נמצאה בקשת וידאו! ' : '')) + 'ירד קובץ zoom-deep-research — פתח ושלח לי.',
      });
    } catch {}
  })();
  sendResponse?.({ ok: true, started: true });
  return true;
});

// ========== Zoom video download (in-page fetch → blob → anchor) ==========
// chrome.downloads.download on the signed ssrweb URL returns an HTML 403 (it
// mangles/strips the CloudFront signature and/or drops the credentialed
// context), saved as a cancelled .htm. But a plain fetch() of the SAME url
// returns 206 video/mp4 (proven by the diagnostic download-probe). So we do
// what real video downloaders do: open the playback page, capture the signed
// URL, fetch() it INSIDE that page (correct cookies + CORS: the MP4 response
// carries access-control-allow-origin for the account domain), and save the
// bytes via a blob + <a download> click. Runs here in the worker so it
// survives the popup closing; a serial queue keeps one big blob in memory at
// a time.
const _mhDlQueue = [];
let _mhDlBusy = false;

function _mhNotify(message, title) {
  try { chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon-128.png', title: title || 'Moodle Hoarder', message }); } catch {}
}

async function _mhCaptureSignedUrl(tabId, quality) {
  await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: () => {
      if (window.__mhRecInstalled) return;
      window.__mhRecInstalled = true; window.__mhRecUrls = [];
      const isSigned = (s) => s && /ssrweb\.zoom\.us/i.test(s) && /\.mp4/i.test(s) && !s.startsWith('blob:');
      const rem = (s) => { if (isSigned(s) && !window.__mhRecUrls.includes(s)) window.__mhRecUrls.push(s); };
      const scan = () => { for (const v of document.querySelectorAll('video, source')) rem(v.currentSrc || v.src || v.getAttribute('src')); };
      new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      scan();
      const of = window.fetch; window.fetch = function (...a) { rem(typeof a[0] === 'string' ? a[0] : (a[0]?.url || '')); return of.apply(this, a); };
      const oo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u) { rem(u); return oo.apply(this, arguments); };
    },
  });
  await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: () => {
      const sels = ['.play-control', '.zm-control-button-play', 'button.play-button', '[aria-label="Play" i]', '[aria-label="הפעל" i]', '[title="Play" i]', '.center-play-btn', '.vjs-play-control', '.lti-recording-item-play-media', '[class*="play-media"]', 'div[role="button"][aria-label*="play" i]'];
      for (const s of sels) { const e = document.querySelector(s); if (e && !e.disabled) { try { e.click(); return; } catch {} } }
      for (const b of document.querySelectorAll('button')) { const t = (b.textContent || '').trim().toLowerCase(); if (t === 'play' || t === 'הפעל') { try { b.click(); return; } catch {} } }
      for (const v of document.querySelectorAll('video')) { try { v.play?.(); } catch {} }
    },
  });
  let urls = []; const start = Date.now();
  while (Date.now() - start < 25000) {
    await new Promise(r => setTimeout(r, 800));
    try { const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => window.__mhRecUrls || [] }); urls = result || []; } catch {}
    if (urls.length > 0 && Date.now() - start > 7000) break;
  }
  if (!urls.length) return null;
  const score = (u) => { const m = (u || '').match(/_(\d{3,4})x(\d{3,4})\.mp4/i); return m ? (+m[1]) * (+m[2]) : 0; };
  urls.sort((a, b) => score(b) - score(a));
  return quality === 'smallest' ? urls[urls.length - 1] : urls[0];
}

// Wait for a download whose filename matches `stem` to finish (or fail).
function _mhWaitForDownload(stem, sinceMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; try { chrome.downloads.onChanged.removeListener(onCh); } catch {} resolve(v); } };
    const base = stem.replace(/\.[^.]+$/, '');
    const onCh = (delta) => {
      if (!delta.state) return;
      chrome.downloads.search({ id: delta.id }, (items) => {
        const it = items && items[0];
        if (!it) return;
        const fn = (it.filename || '').replace(/\\/g, '/').split('/').pop();
        // Serial queue → only one .mp4 is downloading at a time, so match any
        // .mp4 (Hebrew filenames can be re-sanitised, so don't rely on `base`).
        if (!fn || !(/\.mp4$/i.test(fn) || fn.includes(base))) return;
        if (delta.state.current === 'complete') finish({ ok: true, bytes: it.fileSize });
        else if (delta.state.current === 'interrupted') finish({ ok: false, error: it.error || 'interrupted' });
      });
    };
    chrome.downloads.onChanged.addListener(onCh);
    // Safety timeout: 30 min.
    setTimeout(() => finish({ ok: false, error: 'timeout' }), 30 * 60 * 1000);
  });
}

async function _mhDownloadOne(job) {
  const { playUrl, filename, quality } = job;
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url: playUrl, active: false });
    tabId = tab.id;
    await new Promise(r => setTimeout(r, 3500));
    const signed = await _mhCaptureSignedUrl(tabId, quality);
    if (!signed) return { error: 'לא נתפס קישור וידאו (הנגן לא נטען או הקישור פג)' };
    const donePromise = _mhWaitForDownload(filename, Date.now());
    // Fire-and-forget in-page fetch → blob → anchor. The page holds the blob
    // (Chrome spills large blobs to disk) until the browser finishes saving.
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', args: [signed, filename],
      func: (u, fn) => {
        window.__mhDl = 'fetching';
        (async () => {
          try {
            const r = await fetch(u, { credentials: 'include' });
            if (!r.ok) { window.__mhDl = 'http_' + r.status; return; }
            const b = await r.blob();
            const bu = URL.createObjectURL(b);
            const a = document.createElement('a');
            a.href = bu; a.download = fn; document.body.appendChild(a); a.click();
            window.__mhDl = 'started_' + b.size;
            setTimeout(() => { try { URL.revokeObjectURL(bu); a.remove(); } catch {} }, 5 * 60 * 1000);
          } catch (e) { window.__mhDl = 'err_' + (e && e.message || e); }
        })();
        return true;
      },
    });
    // Poll the in-page state until the blob is built + click fired (or error).
    let state = 'fetching'; const t2 = Date.now();
    while (Date.now() - t2 < 25 * 60 * 1000) {
      await new Promise(r => setTimeout(r, 2000));
      try { const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => window.__mhDl || '' }); state = result || ''; } catch {}
      if (state.startsWith('started') || state.startsWith('http_') || state.startsWith('err')) break;
    }
    if (!state.startsWith('started')) return { error: 'fetch בדף נכשל: ' + state };
    // Blob built + download triggered; wait for the browser to finish writing
    // it to disk before we close the tab (closing revokes the blob).
    const res = await donePromise;
    return res.ok ? { ok: true, bytes: res.bytes } : { error: 'הורדה נכשלה: ' + res.error };
  } catch (e) {
    return { error: String(e && e.message || e) };
  } finally {
    if (tabId) { try { await chrome.tabs.remove(tabId); } catch {} }
  }
}

async function _mhProcessQueue() {
  if (_mhDlBusy) return;
  _mhDlBusy = true;
  try {
    while (_mhDlQueue.length) {
      const job = _mhDlQueue.shift();
      const res = await _mhDownloadOne(job);
      if (res.ok) _mhNotify(`✅ ירד: ${job.filename}${res.bytes ? ` (${(res.bytes / 1048576).toFixed(0)}MB)` : ''}`, 'Moodle Hoarder — וידאו');
      else _mhNotify(`❌ נכשל: ${job.filename} — ${res.error}`, 'Moodle Hoarder — וידאו');
    }
  } finally { _mhDlBusy = false; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'mh-download-rec' || !msg.playUrl) return;
  _mhDlQueue.push({ playUrl: msg.playUrl, filename: msg.filename || 'recording.mp4', quality: msg.quality || 'best' });
  _mhProcessQueue();
  sendResponse?.({ ok: true, queued: _mhDlQueue.length });
  return true;
});

function resolveMoodleUrl(url) {
  if (/\/mod\/resource\/view\.php/.test(url)) {
    return url + (url.includes('?') ? '&' : '?') + 'redirect=1';
  }
  const m = url.match(/\/mod\/folder\/view\.php\?(?:[^#]*&)?id=(\d+)/);
  if (m) {
    const u = new URL(url);
    return `${u.origin}/mod/folder/download_folder.php?id=${m[1]}`;
  }
  return url;
}
