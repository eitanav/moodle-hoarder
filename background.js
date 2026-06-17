// Context-menu: right-click any link on Moodle/Ariel → hoard it.
// The visible menu items now follow settings.rightClickBehavior:
//   'immediate' → one item: "הורד עם Moodle Hoarder"  (downloads now)
//   'queue'     → one item: "הוסף לתור Moodle Hoarder" (always queues)
//   'ask'       → two items: download-now + add-to-queue (user picks each time)

importScripts('settings.js', 'zip.js');

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
  // Clear any download status that was left in 'running' state from the
  // previous Chrome session (computer restart / browser kill). The SW starts
  // fresh — queue and busy flag are reset — so a stale 'running' status in
  // storage no longer reflects reality.
  try {
    const s = await chrome.storage.local.get('mhDlStatus');
    if (s.mhDlStatus && s.mhDlStatus.state !== 'complete' && s.mhDlStatus.state !== 'cancelled') {
      await chrome.storage.local.remove('mhDlStatus');
    }
  } catch {}
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
let _mhDlBatch = null;
let _mhCancelRequested = false;

function _mhEnsureBatch(totalHint = 0, meta = {}) {
  if (!_mhDlBatch || (!_mhDlBusy && _mhDlQueue.length === 0 && _mhDlBatch.state === 'complete')) {
    _mhDlBatch = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      startedAt: Date.now(),
      total: 0, completed: 0, failed: 0, bytes: 0,
      files: [], errors: [], state: 'queued',
      ...meta,
    };
  } else {
    _mhDlBatch = { ..._mhDlBatch, ...meta };
  }
  if (totalHint > 0) _mhDlBatch.total += totalHint;
  return _mhDlBatch;
}

function _mhNotify(message, title) {
  try { chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon-128.png', title: title || 'Moodle Hoarder', message }); } catch {}
}

async function _mhCaptureSignedUrl(tabId) {
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

  const parseCandidate = (url, index) => {
    const raw = String(url || '');
    let text = raw;
    try { text = decodeURIComponent(raw); } catch {}
    let width = 0, height = 0;
    const xy = text.match(/(?:^|[^0-9])(\d{3,4})x(\d{3,4})(?:[^0-9]|$)/i);
    if (xy) {
      width = Number(xy[1]) || 0;
      height = Number(xy[2]) || 0;
    } else {
      const p = text.match(/(?:^|[^0-9])(360|480|540|720|1080|1440|2160)p(?:[^0-9]|$)/i);
      if (p) height = Number(p[1]) || 0;
    }
    const pixels = width && height ? width * height : height;
    const label = width && height ? `${width}x${height}` : (height ? `${height}p` : 'unknown');
    return { url: raw, index, pixels, label };
  };

  const candidates = urls.map(parseCandidate);
  const known = candidates.filter(c => c.pixels > 0).sort((a, b) => b.pixels - a.pixels || a.index - b.index);
  const chosen = known[0] || candidates[0];
  console.log('[MH] video candidates:', {
    selection: 'best',
    found: candidates.length,
    detected: known.map(c => c.label),
    chosen: chosen?.label || 'unknown',
    note: known.length ? '' : 'No resolution markers detected; using the first MP4 candidate.',
  });
  return chosen?.url || urls[0];
}

async function _mhAppendHistory(entry) {
  try {
    const key = 'downloadHistory';
    const stored = await chrome.storage.local.get(key);
    const history = Array.isArray(stored[key]) ? stored[key] : [];
    history.unshift({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, ...entry });
    await chrome.storage.local.set({ [key]: history.slice(0, 200) });
  } catch {}
}

// Persisted status so the popup can show progress even without OS notifications.
async function _mhSetStatus(obj) { try { await chrome.storage.local.set({ mhDlStatus: { at: Date.now(), ...obj } }); } catch {} }

// Single offscreen document — runs in the EXTENSION origin, so its fetch() to
// ssrweb bypasses CORS via host_permissions (exactly the context the
// download-probe proved returns 206 video). The in-page fetch was blocked by
// CORS; this is the fix.
async function _mhEnsureOffscreen() {
  try { if (await chrome.offscreen.hasDocument()) return; } catch {}
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Fetch and save Zoom cloud-recording video files.',
    });
  } catch (e) {
    if (!/single offscreen|already/i.test(String(e))) throw e;
  }
}

// Ask the offscreen doc to fetch the signed URL and hand back a blob: URL.

async function _mhOffscreenBuildZip(files) {
  await _mhEnsureOffscreen();
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'mh-offscreen-build-zip', files });
      if (resp?.ok && resp.blobUrl) return resp;
      if (resp?.error) return { error: resp.error };
    } catch (e) {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  return { error: 'offscreen zip builder unreachable' };
}

async function _mhOffscreenFetch(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'mh-offscreen-fetch', url });
      if (resp) return resp;
    } catch (e) {
      // Offscreen not ready yet — wait and retry.
      await new Promise(r => setTimeout(r, 600));
      await _mhEnsureOffscreen();
    }
  }
  return { error: 'offscreen unreachable' };
}

// Wait for a specific chrome.downloads item (by id) to finish.
function _mhWaitForDownloadId(id) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; try { chrome.downloads.onChanged.removeListener(onCh); } catch {} resolve(v); } };
    const onCh = (delta) => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete') {
        chrome.downloads.search({ id }, (items) => done({ ok: true, bytes: items && items[0] && items[0].fileSize }));
      } else if (delta.state.current === 'interrupted') {
        done({ ok: false, error: (delta.error && delta.error.current) || 'interrupted' });
      }
    };
    chrome.downloads.onChanged.addListener(onCh);
    setTimeout(() => done({ ok: false, error: 'timeout' }), 60 * 60 * 1000);
  });
}

// Some recordings' CDN nodes reject a request that lacks the account-domain
// Referer (the browser's <video> request carries it). A fetch() can't set a
// cross-origin Referer itself, so add it via a declarativeNetRequest rule on
// ssrweb requests (this DOES apply to the offscreen doc's xmlhttprequest,
// unlike chrome.downloads requests). Origin derived from the playback URL.
const _MH_REF_RULE_ID = 9021;
let _mhRefRuleOrigin = null;
async function _mhSetRefererRule(origin) {
  if (_mhRefRuleOrigin === origin) return;
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [_MH_REF_RULE_ID],
      addRules: [{
        id: _MH_REF_RULE_ID, priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [
          { header: 'referer', operation: 'set', value: origin + '/' },
          { header: 'origin', operation: 'set', value: origin },
        ] },
        condition: { urlFilter: '||ssrweb.zoom.us', resourceTypes: ['xmlhttprequest', 'other', 'media', 'sub_frame', 'main_frame', 'image'] },
      }],
    });
    _mhRefRuleOrigin = origin;
    console.log('[MH] referer rule set →', origin);
  } catch (e) { console.log('[MH] referer rule failed:', e && e.message || e); }
}

async function _mhDownloadOne(job) {
  const { playUrl, filename } = job;
  let tabId = null, blobUrl = null;
  try {
    // 1) Open the playback page in a hidden tab and capture the signed MP4 URL.
    console.log('[MH] step1: opening playback tab', playUrl);
    const tab = await chrome.tabs.create({ url: playUrl, active: false });
    tabId = tab.id;
    await new Promise(r => setTimeout(r, 3500));
    const signed = await _mhCaptureSignedUrl(tabId);
    try { if (tabId) { await chrome.tabs.remove(tabId); tabId = null; } } catch {}
    console.log('[MH] step1 result: signed URL =', signed ? signed.slice(0, 80) + '… (len ' + signed.length + ')' : 'NULL');
    if (!signed) return { error: 'לא נתפס קישור וידאו (הנגן לא נטען או הקישור פג — סרוק מחדש סמוך ללחיצה)' };
    // 2) Fetch the bytes in the offscreen doc (extension origin → no CORS).
    //    First install the account-domain Referer rule (some CDN nodes need it).
    let refOrigin = 'https://zoom.us';
    try { refOrigin = new URL(playUrl).origin; } catch {}
    await _mhSetRefererRule(refOrigin);
    console.log('[MH] step2: ensuring offscreen + fetching in offscreen…');
    await _mhEnsureOffscreen();
    const resp = await _mhOffscreenFetch(signed);
    console.log('[MH] step2 result:', resp && resp.ok ? ('blob ok, size=' + resp.size) : ('FAIL ' + JSON.stringify(resp)));
    if (!resp.ok) return { error: 'fetch נכשל (' + (resp.error || '?') + ')' };
    blobUrl = resp.blobUrl;
    // 3) Save the blob via chrome.downloads — a clean blob: URL, no signature
    //    to mangle, no network/CORS/referer involved (local data → disk).
    console.log('[MH] step3: chrome.downloads.download(blobUrl)…');
    let downloadId = null;
    try {
      downloadId = await chrome.downloads.download({ url: blobUrl, filename, saveAs: false });
      console.log('[MH] step3 result: downloadId =', downloadId);
    } catch (e) {
      console.log('[MH] step3 chrome.downloads failed, falling back to offscreen anchor:', e && e.message || e);
    }
    if (downloadId == null) {
      // Fallback: let the offscreen doc trigger the download via <a download>.
      const anchorRes = await chrome.runtime.sendMessage({ type: 'mh-offscreen-anchor', blobUrl, filename }).catch((e) => ({ error: String(e) }));
      console.log('[MH] step3 anchor fallback:', JSON.stringify(anchorRes));
      if (!anchorRes || !anchorRes.ok) return { error: 'שמירה נכשלה (downloads+anchor): ' + (anchorRes && anchorRes.error || '?') };
      // Give the browser time to read the blob, then report success (we can't
      // track an anchor download by id). Keep the blob alive a while.
      await new Promise(r => setTimeout(r, 8000));
      return { ok: true, bytes: resp.size, viaAnchor: true };
    }
    const res = await _mhWaitForDownloadId(downloadId);
    console.log('[MH] step4 result:', JSON.stringify(res));
    // Download finished reading the blob → safe to free it now.
    try { chrome.runtime.sendMessage({ type: 'mh-offscreen-revoke', blobUrl }); } catch {}
    return res.ok ? { ok: true, bytes: res.bytes || resp.size } : { error: 'הורדה נכשלה: ' + res.error };
  } catch (e) {
    console.log('[MH] _mhDownloadOne THREW:', e && e.message || e);
    return { error: String(e && e.message || e) };
  } finally {
    // NOTE: do NOT revoke the blob here — the chrome.downloads path revokes
    // after completion, and the anchor-fallback path relies on the offscreen's
    // own 30-min backstop (revoking now would abort an in-progress download).
    if (tabId) { try { await chrome.tabs.remove(tabId); } catch {} }
  }
}

async function _mhProcessQueue() {
  if (_mhDlBusy) return;
  _mhDlBusy = true;
  _mhCancelRequested = false;
  try {
    while (_mhDlQueue.length && !_mhCancelRequested) {
      const job = _mhDlQueue.shift();
      const batch = _mhEnsureBatch();
      const currentIndex = batch.completed + batch.failed + 1;
      await _mhSetStatus({
        kind: 'zoom-videos', state: 'running', batchId: batch.id,
        filename: job.filename, currentIndex, total: batch.total,
        completed: batch.completed, failed: batch.failed, remaining: Math.max(0, batch.total - currentIndex + 1),
        bytes: batch.bytes, courseName: batch.courseName || '', sourceUrl: batch.sourceUrl || '',
      });
      const res = await _mhDownloadOne(job);
      if (res.ok) {
        batch.completed++;
        batch.bytes += res.bytes || 0;
        batch.files.push({ filename: job.filename, bytes: res.bytes || 0, topic: job.topic || '' });
        await _mhSetStatus({
          kind: 'zoom-videos', state: 'item-done', batchId: batch.id,
          filename: job.filename, total: batch.total, completed: batch.completed, failed: batch.failed,
          remaining: Math.max(0, batch.total - batch.completed - batch.failed), bytes: batch.bytes, lastBytes: res.bytes || 0,
          courseName: batch.courseName || '', sourceUrl: batch.sourceUrl || '',
        });
        _mhNotify(`✅ ירד: ${job.filename}${res.bytes ? ` (${(res.bytes / 1048576).toFixed(0)}MB)` : ''}`, 'Moodle Hoarder — וידאו');
      } else {
        batch.failed++;
        batch.errors.push({ filename: job.filename, error: res.error || 'unknown', topic: job.topic || '' });
        await _mhSetStatus({
          kind: 'zoom-videos', state: 'item-error', batchId: batch.id,
          filename: job.filename, error: res.error, total: batch.total, completed: batch.completed, failed: batch.failed,
          remaining: Math.max(0, batch.total - batch.completed - batch.failed), bytes: batch.bytes,
          courseName: batch.courseName || '', sourceUrl: batch.sourceUrl || '',
        });
        _mhNotify(`❌ נכשל: ${job.filename} — ${res.error}`, 'Moodle Hoarder — וידאו');
      }
    }
    if (_mhDlBatch) {
      if (_mhCancelRequested) {
        _mhDlBatch.state = 'cancelled';
        _mhDlBatch.finishedAt = Date.now();
        await _mhSetStatus({
          kind: 'zoom-videos', state: 'cancelled', batchId: _mhDlBatch.id,
          total: _mhDlBatch.total, completed: _mhDlBatch.completed, failed: _mhDlBatch.failed,
          remaining: 0, bytes: _mhDlBatch.bytes, courseName: _mhDlBatch.courseName || '', sourceUrl: _mhDlBatch.sourceUrl || '',
        });
      } else {
        _mhDlBatch.state = 'complete';
        _mhDlBatch.finishedAt = Date.now();
        const status = _mhDlBatch.failed ? (_mhDlBatch.completed ? 'partial' : 'failed') : 'success';
        await _mhSetStatus({
          kind: 'zoom-videos', state: 'complete', batchId: _mhDlBatch.id, status,
          total: _mhDlBatch.total, completed: _mhDlBatch.completed, failed: _mhDlBatch.failed,
          remaining: 0, bytes: _mhDlBatch.bytes, courseName: _mhDlBatch.courseName || '', sourceUrl: _mhDlBatch.sourceUrl || '',
        });
        await _mhAppendHistory({
          type: 'zoom-videos', title: _mhDlBatch.courseName || 'Zoom videos', sourceUrl: _mhDlBatch.sourceUrl || '',
          startedAt: _mhDlBatch.startedAt, finishedAt: _mhDlBatch.finishedAt, status,
          itemCount: _mhDlBatch.total, successCount: _mhDlBatch.completed, failedCount: _mhDlBatch.failed,
          bytes: _mhDlBatch.bytes, files: _mhDlBatch.files.slice(0, 50), errors: _mhDlBatch.errors.slice(0, 20),
        });
      }
    }
    _mhCancelRequested = false;
  } finally { _mhDlBusy = false; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'mh-cancel-downloads') {
    _mhCancelRequested = true;
    _mhDlQueue.length = 0;
    sendResponse?.({ ok: true });
    return true;
  }
  if (msg?.type === 'mh-dl-status-query') {
    sendResponse?.({ busy: _mhDlBusy, queueLength: _mhDlQueue.length });
    return true;
  }
  if (msg?.type === 'mh-download-recs' && Array.isArray(msg.jobs) && msg.jobs.length) {
    console.log('[MH] mh-download-recs received:', msg.jobs.length, 'jobs');
    _mhEnsureBatch(msg.jobs.length, { courseName: msg.courseName || '', sourceUrl: msg.sourceUrl || '' });
    for (const job of msg.jobs) {
      _mhDlQueue.push({
        playUrl: job.playUrl, filename: job.filename || 'recording.mp4',
        topic: job.topic || '', date: job.date || '',
      });
    }
    _mhSetStatus({
      kind: 'zoom-videos', state: _mhDlBusy ? 'queued' : 'starting', batchId: _mhDlBatch?.id,
      total: _mhDlBatch?.total || msg.jobs.length, completed: _mhDlBatch?.completed || 0, failed: _mhDlBatch?.failed || 0,
      remaining: _mhDlQueue.length, bytes: _mhDlBatch?.bytes || 0, courseName: _mhDlBatch?.courseName || '', sourceUrl: _mhDlBatch?.sourceUrl || '',
    });
    _mhProcessQueue();
    sendResponse?.({ ok: true, queued: _mhDlQueue.length, total: _mhDlBatch?.total || msg.jobs.length });
    return true;
  }
  if (msg?.type !== 'mh-download-rec' || !msg.playUrl) return;
  console.log('[MH] mh-download-rec received:', msg.filename, msg.playUrl);
  _mhEnsureBatch(1, { courseName: msg.courseName || '', sourceUrl: msg.sourceUrl || '' });
  _mhDlQueue.push({ playUrl: msg.playUrl, filename: msg.filename || 'recording.mp4', topic: msg.topic || '', date: msg.date || '' });
  _mhProcessQueue();
  sendResponse?.({ ok: true, queued: _mhDlQueue.length, total: _mhDlBatch?.total || 1 });
  return true;
});


// ========== Zoom transcript extraction (background service worker) ==========
// Popup resolves share/play URLs, then hands the heavy VTT extraction to this
// worker so closing the popup no longer kills the transcript job.
let _mhTrBusy = false;
let _mhTrCancelRequested = false;
let _mhTrBatch = null;

async function _mhSetTrStatus(obj) {
  try { await chrome.storage.local.set({ mhTrStatus: { at: Date.now(), ...obj } }); } catch {}
}

function _mhTrTextBlob(s, type = 'text/plain;charset=utf-8') {
  return new Blob([s], { type });
}

function _mhTrSanitizeFilename(name) {
  if (!name) return '';
  return String(name)
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[_\s]*_[_\s]*/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 120);
}

function _mhTrTranscriptFileStem(rec) {
  const topic = _mhTrSanitizeFilename(rec.topic || '') || 'recording';
  let dateBit = '';
  if (rec.date) {
    const d = new Date(rec.date);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      dateBit = `_${y}-${mo}-${da}_${hh}-${mm}`;
    } else {
      const sanitised = (rec.date || '').replace(/[^\w-]+/g, '_').slice(0, 24);
      if (sanitised) dateBit = `_${sanitised}`;
    }
  }
  return `${topic}${dateBit}`;
}

function _mhTrZipFilename(recordings, isoDate) {
  const topics = (recordings || []).map(r => (r.topic || '').trim()).filter(Boolean);
  if (topics.length) {
    const counts = new Map();
    for (const t of topics) counts.set(t, (counts.get(t) || 0) + 1);
    let dom = null, max = 0;
    for (const [t, c] of counts) if (c > max) { max = c; dom = t; }
    if (dom && max / topics.length >= 0.7) return `${_mhTrSanitizeFilename(dom) || 'zoom'} הקלטות_${isoDate}.zip`;
  }
  return `zoom-recordings_${isoDate}.zip`;
}

function _mhTrHistoryTitle(recordings) {
  const topics = (recordings || []).map(r => (r.topic || '').trim()).filter(Boolean);
  if (!topics.length) return 'Zoom transcripts';
  const counts = new Map();
  for (const t of topics) counts.set(t, (counts.get(t) || 0) + 1);
  let dom = topics[0], max = 0;
  for (const [t, c] of counts) if (c > max) { dom = t; max = c; }
  return topics.length > 1 ? `${dom} — ${topics.length} הקלטות` : dom;
}

function _mhTrVttToCleanText(vtt) {
  if (!vtt) return '';
  const lines = vtt.split(/\r?\n/);
  const out = [];
  let currentStart = null;
  let buffer = [];
  const flushCue = () => {
    if (!buffer.length) return;
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
    if (text) out.push(currentStart ? `[${currentStart}] ${text}` : text);
    buffer = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'WEBVTT' || line.startsWith('WEBVTT')) continue;
    if (line.startsWith('NOTE') || line.startsWith('X-TIMESTAMP-MAP') || line.startsWith('STYLE')) continue;
    if (/^\d+$/.test(line)) continue;
    const tsMatch = line.match(/^(\d{1,2}:\d{2}:\d{2})[.,]\d+\s*-->\s*\d/);
    if (tsMatch) { flushCue(); currentStart = tsMatch[1]; continue; }
    const tsMatch2 = line.match(/^(\d{1,2}:\d{2})[.,]\d+\s*-->\s*\d/);
    if (tsMatch2) { flushCue(); currentStart = tsMatch2[1]; continue; }
    if (!line) { flushCue(); continue; }
    buffer.push(line);
  }
  flushCue();
  return out.join('\n');
}

function _mhTrRecordingsText(data) {
  const lines = [];
  lines.push('Moodle Hoarder — Zoom Recordings');
  lines.push('================================');
  lines.push(`Source: ${data.sourceUrl || '?'}`);
  lines.push(`Date:   ${new Date().toLocaleString('he-IL')}`);
  lines.push(`Found:  ${data.recordings.length} recordings`);
  lines.push('');
  lines.push('=========================================================');
  lines.push('');
  data.recordings.forEach((r, i) => {
    lines.push(`#${i + 1}. ${r.topic || '(no topic)'}`);
    if (r.meetingId) lines.push(`    Meeting ID: ${r.meetingId}`);
    if (r.date) lines.push(`    Date:       ${r.date}`);
    lines.push(`    URL:        ${r.url || '(no URL)'}`);
    lines.push('');
  });
  lines.push('=========================================================');
  lines.push('');
  lines.push(`נמצאו קישורים ל-${data.recordings.filter(r => r.url).length} מתוך ${data.recordings.length} הקלטות.`);
  return lines.join('\r\n');
}

async function _mhTrExtractOne(rec, opts = {}) {
  let tab = null;
  const retry = !!opts.retry;
  const debug = { attempt: opts.attempt || 1, retry, snapshots: [] };
  const INITIAL_SETTLE = retry ? 6500 : 4500;
  const EARLY_BAIL_MS = retry ? 16000 : 12000;
  const HARD_TIMEOUT_MS = retry ? 45000 : 32000;
  try {
    tab = await chrome.tabs.create({ url: rec.url, active: false });
    debug.tabId = tab.id || null;
    await new Promise(r => setTimeout(r, INITIAL_SETTLE));
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN',
      func: () => {
        if (window.__mhVttInstalled) return;
        window.__mhVttInstalled = true;
        window.__mhVtt = null;
        window.__mhVttSeen = [];
        const isVtt = (u) => /\/rec\/play\/vtt\b[^?]*\??[^#]*type=transcript/i.test(u || '');
        const remember = (url, source, status, body) => {
          try { window.__mhVttSeen.push({ url: String(url || ''), source, status: status || 0, bytes: body ? body.length : 0, at: Date.now() }); } catch {}
          if (body && body.includes('WEBVTT')) window.__mhVtt = { url, body, source };
        };
        const fetchVtt = async (url, source) => {
          if (!url) return;
          try {
            const res = await fetch(url, { credentials: 'include' });
            const body = await res.clone().text();
            remember(url, source, res.status, body);
          } catch (e) { remember(url, source + ':error:' + String(e), 0, ''); }
        };
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) { this.__mhU = url; return origOpen.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function () {
          if (isVtt(this.__mhU)) {
            this.addEventListener('load', () => {
              try { if (this.status === 200) remember(this.__mhU, 'xhr', this.status, this.responseText || ''); } catch {}
            });
          }
          return origSend.apply(this, arguments);
        };
        const origFetch = window.fetch;
        window.fetch = async function (...args) {
          const url = (typeof args[0] === 'string') ? args[0] : (args[0]?.url || '');
          const res = await origFetch.apply(this, args);
          if (isVtt(url)) {
            try { remember(url, 'fetch', res.status, await res.clone().text()); } catch {}
          }
          return res;
        };
        try {
          for (const entry of performance.getEntriesByType('resource')) {
            const url = entry && entry.name;
            if (isVtt(url)) fetchVtt(url, 'performance');
          }
        } catch {}
        try {
          for (const btn of document.querySelectorAll('button, [role="button"], [aria-label], [title]')) {
            const txt = ((btn.textContent || '') + ' ' + (btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('title') || '')).toLowerCase();
            if (/transcript|caption|cc|תמל|כתוב/.test(txt) && btn.offsetParent !== null) { btn.click(); break; }
          }
        } catch {}
      },
    });
    const start = Date.now();
    let payload = null;
    let earlyChecked = false;
    while (Date.now() - start < HARD_TIMEOUT_MS) {
      if (_mhTrCancelRequested) return { recording: rec, error: 'cancelled', skipReason: 'cancelled', debug };
      await new Promise(r => setTimeout(r, 600));
      let snap = null;
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN',
          func: () => ({
            vtt: window.__mhVtt || null,
            seen: window.__mhVttSeen || [],
            uiHints: {
              transcriptClass: !!document.querySelector('[class*="transcript" i]'),
              transcriptDataAttr: !!document.querySelector('[data-test*="transcript" i], [data-testid*="transcript" i]'),
              ccButton: !!document.querySelector('button[aria-label*="transcript" i], button[aria-label*="caption" i], button[aria-label*="CC" i]'),
              captionsTrack: !!document.querySelector('track[kind="captions"], track[kind="subtitles"]'),
            },
          }),
        });
        snap = result;
        if (snap && debug.snapshots.length < 8) debug.snapshots.push({ seenCount: (snap.seen || []).length, lastSeen: (snap.seen || []).slice(-2), uiHints: snap.uiHints || {} });
      } catch (e) { debug.snapshots.push({ error: String(e) }); }
      if (snap?.vtt?.body) { payload = snap.vtt; break; }
      if (!earlyChecked && Date.now() - start >= EARLY_BAIL_MS) {
        earlyChecked = true;
        const hints = snap?.uiHints || {};
        if (!(hints.transcriptClass || hints.transcriptDataAttr || hints.ccButton || hints.captionsTrack)) {
          return { recording: rec, error: `No transcript UI in DOM after ${EARLY_BAIL_MS / 1000}s`, skipReason: 'no-transcript-ui', debug };
        }
      }
    }
    if (payload) return { recording: rec, vtt: payload.body, vttUrl: payload.url, txt: _mhTrVttToCleanText(payload.body), debug };
    return { recording: rec, error: `Timeout: ${HARD_TIMEOUT_MS / 1000}s without transcript`, skipReason: 'timeout', debug };
  } finally {
    if (tab?.id) { try { await chrome.tabs.remove(tab.id); } catch {} }
  }
}

async function _mhTrExtractWithRetry(rec) {
  const attempts = [];
  let first = await _mhTrExtractOne(rec, { attempt: 1 });
  attempts.push({ attempt: 1, ok: !!first.vtt, error: first.error || '', skipReason: first.skipReason || '', debug: first.debug || null });
  if (!first.vtt && /timeout|no-transcript-ui|script|tab/i.test(first.skipReason || first.error || '')) {
    await new Promise(r => setTimeout(r, 1000));
    const second = await _mhTrExtractOne(rec, { attempt: 2, retry: true });
    attempts.push({ attempt: 2, ok: !!second.vtt, error: second.error || '', skipReason: second.skipReason || '', debug: second.debug || null });
    first = second.vtt ? second : { ...first, attempts };
  }
  return { ...first, attempts };
}

// Bucket per-item failure into a short stable key so the popup can show a
// running breakdown (e.g. "4 ללא תמלול ב-Zoom") instead of just "4 נכשלו".
// Order matters: the first match wins.
function _mhTrFailureKey(res) {
  const skip = (res?.skipReason || '').toLowerCase();
  if (skip === 'no-transcript-ui') return 'no-transcript';
  if (skip === 'timeout') return 'timeout';
  if (skip === 'cancelled') return 'cancelled';
  const err = String(res?.error || '').toLowerCase();
  if (/cancel/.test(err)) return 'cancelled';
  if (/timeout|no transcript ui|after \d+s without/.test(err)) return /no transcript/.test(err) ? 'no-transcript' : 'timeout';
  if (/sign in|signin|log ?in|password|denied|forbidden|403|401/.test(err)) return 'auth';
  if (/tab|navigation|executescript|cannot access|script/.test(err)) return 'tab-error';
  return 'other';
}

async function _mhStartTranscriptJob(msg) {
  if (_mhTrBusy) return { ok: false, error: 'transcript job already running' };
  const recordings = (msg.recordings || []).filter(r => r && r.url);
  if (!recordings.length) return { ok: false, error: 'no recordings with URLs' };
  _mhTrBusy = true;
  _mhTrCancelRequested = false;
  const startedAt = Date.now();
  const concurrency = Math.max(1, Math.min(+(msg.concurrency || 3), recordings.length));
  const fmt = msg.format || 'txt';
  _mhTrBatch = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, total: recordings.length, completed: 0, failed: 0, success: 0, startedAt, recordings, sourceUrl: msg.sourceUrl || '', courseName: msg.courseName || '', failureReasons: {} };
  _mhSetTrStatus({ kind: 'zoom-transcripts', state: 'starting', batchId: _mhTrBatch.id, total: recordings.length, completed: 0, failed: 0, success: 0, remaining: recordings.length, concurrency, courseName: _mhTrBatch.courseName, sourceUrl: _mhTrBatch.sourceUrl, failureReasons: {} });

  (async () => {
    const results = new Array(recordings.length);
    let nextIdx = 0;
    async function worker(workerId) {
      while (!_mhTrCancelRequested) {
        const i = nextIdx++;
        if (i >= recordings.length) return;
        const rec = recordings[i];
        await _mhSetTrStatus({ kind: 'zoom-transcripts', state: 'running', batchId: _mhTrBatch.id, currentIndex: i + 1, total: recordings.length, completed: _mhTrBatch.completed, failed: _mhTrBatch.failed, success: _mhTrBatch.success, remaining: recordings.length - _mhTrBatch.completed - _mhTrBatch.failed, filename: rec.topic || rec.url, concurrency, workerId, courseName: _mhTrBatch.courseName, sourceUrl: _mhTrBatch.sourceUrl });
        let res;
        try { res = await _mhTrExtractWithRetry(rec); }
        catch (e) { res = { recording: rec, error: String(e), attempts: [] }; }
        results[i] = res;
        if (res.vtt) {
          _mhTrBatch.success++;
        } else {
          _mhTrBatch.failed++;
          const key = _mhTrFailureKey(res);
          _mhTrBatch.failureReasons[key] = (_mhTrBatch.failureReasons[key] || 0) + 1;
        }
        _mhTrBatch.completed++;
        await _mhSetTrStatus({ kind: 'zoom-transcripts', state: res.vtt ? 'item-done' : 'item-error', batchId: _mhTrBatch.id, currentIndex: i + 1, total: recordings.length, completed: _mhTrBatch.completed, failed: _mhTrBatch.failed, success: _mhTrBatch.success, remaining: recordings.length - _mhTrBatch.completed, filename: rec.topic || rec.url, error: res.error || '', skipReason: res.skipReason || '', failureReasons: { ..._mhTrBatch.failureReasons }, concurrency, courseName: _mhTrBatch.courseName, sourceUrl: _mhTrBatch.sourceUrl });
      }
    }
    let zipName = '';
    let zipSize = 0;
    try {
      await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i + 1)));
      const files = [];
      files.push({ path: 'הקלטות.txt', text: '﻿' + _mhTrRecordingsText({ recordings, sourceUrl: msg.sourceUrl || '' }), type: 'text/plain;charset=utf-8' });
      const summary = [];
      summary.push('Moodle Hoarder — Zoom Transcripts');
      summary.push('===================================');
      summary.push(`Captured at: ${new Date().toISOString()}`);
      summary.push(`Total recordings: ${recordings.length}`);
      summary.push(`With transcript: ${results.filter(t => t?.vtt).length}`);
      summary.push(`Failed: ${results.filter(t => !t?.vtt).length}`);
      summary.push(`Concurrency: ${concurrency}`);
      summary.push(`Format: ${fmt}`);
      summary.push('');
      for (const tres of results) {
        const baseName = _mhTrTranscriptFileStem(tres.recording || {});
        if (tres.vtt) {
          if (fmt !== 'txt') files.push({ path: `${baseName}.vtt`, text: tres.vtt, type: 'text/vtt;charset=utf-8' });
          if (fmt !== 'vtt') files.push({ path: `${baseName}.txt`, text: '﻿' + tres.txt, type: 'text/plain;charset=utf-8' });
          summary.push(`✓ ${baseName}  (VTT ${tres.vtt.length}B, TXT ${tres.txt.length}B)`);
        } else {
          summary.push(`✗ ${baseName}  — ${tres.error || 'unknown'}`);
        }
      }
      const okT = results.filter(t => t?.vtt).length;
      const transcriptDebug = { schema: 'moodle-hoarder.zoom-transcripts-debug.v1', capturedAt: new Date().toISOString(), sourceUrl: msg.sourceUrl || '', transcriptCount: recordings.length, successCount: okT, failedCount: recordings.length - okT, concurrency, format: fmt, results: results.map(t => ({ recording: t.recording, ok: !!t.vtt, vttUrl: t.vttUrl || '', vttBytes: t.vtt ? t.vtt.length : 0, txtBytes: t.txt ? t.txt.length : 0, error: t.error || '', skipReason: t.skipReason || '', attempts: t.attempts || [], debug: t.debug || null })) };
      files.push({ path: '_status.txt', text: '﻿' + summary.join('\r\n'), type: 'text/plain;charset=utf-8' });
      files.push({ path: '_debug.json', text: JSON.stringify(transcriptDebug, null, 2), type: 'application/json;charset=utf-8' });
      const zipResp = await _mhOffscreenBuildZip(files);
      if (!zipResp?.ok) throw new Error('offscreen zip failed: ' + (zipResp?.error || 'unknown'));
      zipSize = zipResp.size || 0;
      const url = zipResp.blobUrl;
      const date = new Date().toISOString().slice(0, 10);
      zipName = _mhTrZipFilename(recordings, date);
      await chrome.downloads.download({ url, filename: zipName, saveAs: !!msg.saveAs });
      setTimeout(() => { try { chrome.runtime.sendMessage({ type: 'mh-offscreen-revoke', blobUrl: url }); } catch {} }, 60_000);
      const status = okT === recordings.length ? 'success' : (okT ? 'partial' : 'failed');
      await _mhSetTrStatus({ kind: 'zoom-transcripts', state: 'complete', batchId: _mhTrBatch.id, status, total: recordings.length, completed: recordings.length, failed: recordings.length - okT, success: okT, remaining: 0, filename: zipName, bytes: zipSize, failureReasons: { ..._mhTrBatch.failureReasons }, concurrency, courseName: _mhTrBatch.courseName, sourceUrl: _mhTrBatch.sourceUrl });
      await _mhAppendHistory({ type: 'zoom-links', title: _mhTrHistoryTitle(recordings), sourceUrl: msg.sourceUrl || '', startedAt, finishedAt: Date.now(), status, itemCount: recordings.length, successCount: okT, failedCount: recordings.length - okT, bytes: zipSize, filename: zipName });
      _mhNotify(`Zoom תמלילים: חולצו ${okT}/${recordings.length}. ${zipName}`, 'Moodle Hoarder — Zoom');
    } catch (e) {
      await _mhSetTrStatus({ kind: 'zoom-transcripts', state: 'error', batchId: _mhTrBatch.id, error: String(e), total: recordings.length, completed: _mhTrBatch.completed, failed: _mhTrBatch.failed, success: _mhTrBatch.success, remaining: Math.max(0, recordings.length - _mhTrBatch.completed), failureReasons: { ..._mhTrBatch.failureReasons }, concurrency, courseName: _mhTrBatch.courseName, sourceUrl: _mhTrBatch.sourceUrl });
      _mhNotify('שגיאה בחילוץ תמלילים: ' + String(e), 'Moodle Hoarder — Zoom');
    } finally {
      _mhTrBusy = false;
      _mhTrCancelRequested = false;
    }
  })();
  return { ok: true, started: true, total: recordings.length, concurrency };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'mh-cancel-transcripts') {
    _mhTrCancelRequested = true;
    sendResponse?.({ ok: true });
    return true;
  }
  if (msg?.type === 'mh-tr-status-query') {
    sendResponse?.({ busy: _mhTrBusy, batch: _mhTrBatch });
    return true;
  }
  if (msg?.type === 'mh-extract-transcripts') {
    _mhStartTranscriptJob(msg).then(sendResponse).catch(e => sendResponse?.({ ok: false, error: String(e) }));
    return true;
  }
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
