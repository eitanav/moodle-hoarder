// ===================== Moodle Hoarder =====================
// Popup orchestrates: scan -> pick -> download -> zip.

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const initialView   = $('initial');
const pickerView    = $('picker');
const multiView     = $('multiPicker');
const sectionsEl    = $('sections');
const coursesEl     = $('courses');
const searchEl      = $('search');
const selCountEl    = $('selCount');
const totCountEl    = $('totCount');
const totCoursesEl  = $('totCourses');
const statusEl      = $('status');
const logEl         = $('log');
const progressWrap  = $('progressWrap');
const progressBar   = $('progressBar');
const diffBanner    = $('diffBanner');
const diffText      = $('diffText');

let scanned = null;        // single course: { courseName, courseId, courseUrl, sections, prevSeen }
let multiScanned = null;   // multi: { courses: [{id, name, url}] }
let zoomScanned = null;    // zoom: { data: { recordings, pages, pageUrl }, tabId }
let deadlinesScanned = null; // dashboard: { deadlines: [...], tabId }

// ---------- Constants ----------
const ACTIVITY_RE = /\/mod\/(resource|folder|assign|url|page|book|forum|quiz|lesson|choice|feedback|workshop|wiki|chat|glossary|scorm|h5pactivity)\/view\.php\?(?:[^#]*&)?id=(\d+)/;
const ALWAYS_OFF_TYPES = new Set(['forum','chat','feedback','choice','wiki','glossary']);
const INTRO_OFF_TYPES  = new Set(['url']);
const DOWNLOAD_HISTORY_KEY = 'downloadHistory';

const STREAM_HOSTS = [
  // Recording / video platforms
  'zoom.us','panopto','kaltura','mediasite','youtu','vimeo.com','dailymotion','twitch.tv',
  // Conference / meeting platforms (links won't be live anymore, but worth keeping for reference)
  'teams.microsoft.com','meet.google.com','meet.goto.com','gotomeeting.com','goto.com',
  'webex.com','meet.jit.si','whereby.com','bigbluebutton',
  // File-share / cloud
  'sharepoint.com','onedrive','drive.google.com','docs.google.com','dropbox.com','box.com',
  // Social video
  'facebook.com','instagram.com','tiktok.com',
];

// Only these hosts are in our manifest's host_permissions — fetching anything else
// triggers a CORS error in chrome://extensions even if try/catch'd. Save as link instead.
function isAllowedHost(u) {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return host === 'ariel.ac.il' || host.endsWith('.ariel.ac.il');
  } catch { return false; }
}

// ---------- Status helpers ----------
function setStatus(t) { statusEl.textContent = t; }
function logLine(t, cls = '') {
  logEl.classList.add('show');
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = t;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
function setProgress(done, total) {
  if (total <= 0) { progressWrap.style.display = 'none'; return; }
  progressWrap.style.display = 'block';
  progressBar.style.width = Math.round((done / total) * 100) + '%';
}
function renderZoomVideoStatus(st) {
  if (!st || st.kind !== 'zoom-videos') return;
  const total = Math.max(0, +(st.total || 0));
  const completed = Math.max(0, +(st.completed || 0));
  const failed = Math.max(0, +(st.failed || 0));
  const finished = completed + failed;
  if (total > 0) setProgress(Math.min(finished, total), total);
  const size = st.bytes ? ` · ${formatSize(st.bytes)}` : '';
  if (st.state === 'running') {
    const idx = st.currentIndex || (finished + 1);
    setStatus(`🎥 מוריד סרטונים: ${idx}/${total} — ${st.filename || ''} (${completed} הסתיימו, ${failed} נכשלו)${size}`);
  } else if (st.state === 'starting' || st.state === 'queued') {
    setStatus(`🎥 מכין תור הורדות: ${total} סרטונים`);
  } else if (st.state === 'item-done') {
    setStatus(`🎥 ${completed}/${total} ירדו (${failed} נכשלו)${size}`);
  } else if (st.state === 'item-error') {
    setStatus(`🎥 ${completed}/${total} ירדו, ${failed} נכשלו — ${st.filename || ''}: ${st.error || ''}`);
  } else if (st.state === 'complete') {
    setProgress(total, total);
    const label = failed ? `הסתיים חלקית: ${completed}/${total} ירדו, ${failed} נכשלו` : `כל ${total} הסרטונים ירדו`;
    setStatus(`✅ ${label}${size}. אם Windows לא פותח את הקובץ — נסה VLC.`);
  }
}
function showView(name) {
  const views = {
    initial:   initialView,
    picker:    pickerView,
    multi:     multiView,
    zoom:      document.getElementById('zoomPicker'),
    deadlines: document.getElementById('deadlinesView'),
  };
  for (const [k, el] of Object.entries(views)) {
    if (!el) continue;
    el.style.display = (k === name) ? 'block' : 'none';
  }
  setSkeleton(false);
  // Trigger the fade-in animation on the new view
  const showing = views[name];
  if (showing) {
    showing.classList.remove('mh-view-show');
    // Force a reflow so the animation re-fires
    void showing.offsetWidth;
    showing.classList.add('mh-view-show');
  }
}

// Settings button opens the options page in a new tab.
document.getElementById('openSettings')?.addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
});

// Keyboard shortcuts (ROADMAP #2). Only fire when the popup focus is NOT
// inside a text input — otherwise typing into the search field would
// trigger them. Bindings:
//   Ctrl/Cmd + S   → scan (or download-queue if available)
//   Ctrl/Cmd + A   → select all in the current picker
//   Ctrl/Cmd + D   → download (picker / multi / zoom / deadlines export)
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const tag = (e.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  const key = e.key.toLowerCase();
  let handled = false;
  if (key === 's') {
    handled = true;
    const scan = document.getElementById('scan');
    if (scan && !scan.disabled) scan.click();
  } else if (key === 'a') {
    handled = true;
    // Pick the visible "Select all" link/button
    for (const id of ['selAll', 'courseAll', 'zoomAll']) {
      const el = document.getElementById(id);
      if (el && el.offsetParent !== null) { el.click(); break; }
    }
  } else if (key === 'd') {
    handled = true;
    for (const id of ['download', 'downloadMulti', 'downloadZoomLinks', 'exportDeadlines', 'downloadQueue']) {
      const el = document.getElementById(id);
      if (el && el.offsetParent !== null && !el.disabled) { el.click(); break; }
    }
  }
  if (handled) e.preventDefault();
});

// Bootstrap: load settings into the cache before anything else runs.
// Also auto-trigger the dashboard deadlines scan when the popup opens on
// /my/ — the user doesn't need to press "סרוק" there; opening the popup
// is already an explicit intent.
(async () => {
  // Defensive: a throw here (e.g. settings.js / i18n.js bug) was previously
  // silently swallowed — the popup looked fine but every button click
  // ended in confusion. Log loudly so we can see it in DevTools.
  try {
    await loadCachedSettings();
  } catch (e) {
    console.error('[Moodle Hoarder] loadCachedSettings failed:', e);
  }
  try {
    await refreshQueueArea();
  } catch (e) {
    console.error('[Moodle Hoarder] refreshQueueArea failed:', e);
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /moodlearn\.ariel\.ac\.il\/my\/?(?:[?#]|$|index\.php)/.test(tab.url)) {
      await runDashboardScan(tab);
    }
  } catch (e) {
    console.error('[Moodle Hoarder] auto-dashboard-scan failed:', e);
  }
})();

// Dashboard scan: shared between auto-bootstrap and the manual scan button
// (in case the auto-scan needs to be retried).
async function runDashboardScan(tab) {
  $('scan').disabled = true;
  setStatus(t('status.opening.activities'));
  try {
    await expandTimelineActivities(tab.id);
    setStatus(t('status.scanning.deadlines'));
    const deadlines = await scanDeadlinesInActiveTab(tab.id);
    if (!deadlines.length) {
      setStatus(t('status.no.deadlines'));
      $('scan').disabled = false;
      return;
    }
    const annotated = await annotateDeadlines(deadlines);
    deadlinesScanned = { deadlines: annotated, tabId: tab.id };
    // Persist the snapshot RIGHT AWAY (not only on export) so the next visit
    // can diff against it even if the user closes the popup without exporting.
    await chrome.storage.local.set({
      deadlinesSnapshot: {
        date: Date.now(),
        deadlines: deadlines.map(d => ({ id: d.id, due: d.due })),
      },
    });
    renderDeadlines();
  } catch (e) {
    setStatus(t('status.error.with.message', { msg: e.message }));
    $('scan').disabled = false;
  }
}

// Click any "Show more activities" / "פעילויות נוספות" / "Load more" button
// in the timeline so the popup sees the full list, not just the first page.
// We keep clicking until the row count stops growing.
async function expandTimelineActivities(tabId) {
  for (let i = 0; i < 8; i++) {
    let progress;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const before = document.querySelectorAll(
            '[data-region="event-list-item"], [data-region="dashboard-timeline-event"],' +
            ' .event-list-item, .timeline-event-list-item'
          ).length;
          // Find a "show more" button.
          const candidates = [
            ...document.querySelectorAll('[data-region="view-more"] button'),
            ...document.querySelectorAll('[data-action="more-events"]'),
            ...document.querySelectorAll('button.more-events, button.see-more'),
            ...document.querySelectorAll('button, a'),
          ];
          let clicked = null;
          for (const el of candidates) {
            const txt = (el.textContent || '').trim();
            if (/show\s*more|view\s*more|הצג\s*עוד|פעילויות\s*נוספות|הצגת\s*פעילויות|טען\s*עוד|load\s*more/i.test(txt)) {
              if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
              el.click();
              clicked = txt;
              break;
            }
          }
          return { before, clicked };
        },
      });
      progress = results[0]?.result;
    } catch { break; }
    if (!progress?.clicked) break;
    // Give Moodle time to fetch & render the next batch
    await new Promise(r => setTimeout(r, 700));
  }
}

// ========== Right-click queue ==========
const QUEUE_KEY = 'rightClickQueue';

async function getQueue() {
  const s = await chrome.storage.local.get(QUEUE_KEY);
  return s[QUEUE_KEY] || [];
}
async function setQueue(q) {
  await chrome.storage.local.set({ [QUEUE_KEY]: q });
  try { chrome.runtime.sendMessage({ type: 'refreshBadge' }); } catch {}
}
async function refreshQueueArea() {
  const q = await getQueue();
  const area = document.getElementById('queueArea');
  if (!area) return;
  if (q.length === 0) { area.style.display = 'none'; return; }
  area.style.display = 'block';
  document.getElementById('queueCountText').textContent = `${q.length} פריטים בתור`;
}

document.getElementById('clearQueue')?.addEventListener('click', async () => {
  if (!confirm(t('queue.clear.confirm'))) return;
  await setQueue([]);
  await refreshQueueArea();
});

document.getElementById('downloadQueue')?.addEventListener('click', async () => {
  const q = await getQueue();
  if (!q.length) return;
  document.getElementById('downloadQueue').disabled = true;
  setStatus(t('status.downloading.queue', { n: q.length }));
  setProgress(0, q.length);
  const files = [];
  const used = new Set();
  let done = 0;
  for (const entry of q) {
    done++;
    setStatus(`(${done}/${q.length}) ${entry.linkText || entry.url}`);
    setProgress(done, q.length);
    try {
      const res = await fetch(entry.url, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      let name = filenameFromResponse(res) || decodeURIComponent(entry.url.split('/').pop().split('?')[0]) || 'file';
      name = sanitizeFilename(name) || 'file';
      const path = uniquePath(used, name);
      files.push({ path, blob });
      logLine(`✓ ${path} (${formatSize(blob.size)})`, 'ok');
    } catch (e) {
      logLine(`✗ ${entry.url}: ${e.message}`, 'err');
    }
  }
  if (!files.length) {
    setStatus(t('status.queue.failed'));
    document.getElementById('downloadQueue').disabled = false;
    return;
  }
  setStatus(t('status.zipping.bundle'));
  const zipBlob = await buildZip(files);
  const url = URL.createObjectURL(zipBlob);
  const filename = `moodle-hoarder-queue-${new Date().toISOString().slice(0, 10)}.zip`;
  await chrome.downloads.download({ url, filename, saveAs: !!CACHED_SETTINGS?.saveAs });
  await setQueue([]);
  await refreshQueueArea();
  setStatus(t('status.completed.with.count', { n: files.length, size: formatSize(zipBlob.size) }));
  notify('Moodle Hoarder', t('notif.queue.done', { n: files.length }));
  document.getElementById('downloadQueue').disabled = false;
});

// ---------- Initial: scan button ----------
function setSkeleton(show) {
  const el = document.getElementById('skeleton');
  if (el) el.classList.toggle('show', show);
}

$('scan').addEventListener('click', async () => {
  $('scan').disabled = true;
  setSkeleton(true);
  setStatus(t('status.checking.page'));
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) throw new Error(t('err.no.active.tab'));

    if (/zoom\.us/.test(tab.url)) {
      setStatus(t('status.waiting.zoom'));
      const data = await scrapeAllZoomPages(tab.id, (s) => setStatus(s));
      if (data.recordings.length === 0) {
        await saveZoomFile(data);
        setStatus(t('status.no.zoom'));
        $('scan').disabled = false;
        return;
      }
      zoomScanned = { data, tabId: tab.id };
      renderZoomPicker();
      return;
    } else if (/moodlearn\.ariel\.ac\.il\/my\/courses\.php/.test(tab.url)) {
      setStatus(t('status.scanning.courses'));
      // Moodle 4.x's "My Courses" page renders the cards via JS after page
      // load, so fetching the URL fresh returns an empty skeleton. Read the
      // live DOM from the active tab instead.
      const courses = await scanCoursesInActiveTab(tab.id);
      if (!courses.length) {
        setStatus(t('status.no.courses'));
        $('scan').disabled = false;
        return;
      }
      multiScanned = { courses };
      renderMulti();
    } else if (/moodlearn\.ariel\.ac\.il\/my\/?(?:[?#]|$|index\.php)/.test(tab.url)) {
      // Manual retry of the auto-scan that runs on popup open.
      await runDashboardScan(tab);
      return;
    } else if (/moodlearn\.ariel\.ac\.il\/course\/view\.php/.test(tab.url)) {
      setStatus(t('status.scanning.course'));
      scanned = await scanCourse(tab.url);
      if (!scanned.sections.length) {
        setStatus(t('status.no.items'));
        $('scan').disabled = false;
        return;
      }
      renderPicker();
    } else {
      setStatus(t('status.wrong.page'));
      $('scan').disabled = false;
    }
  } catch (e) {
    // Surface the full error in DevTools so we can diagnose scan
    // breakage — the i18n'd status only shows e.message which often
    // hides the actual stack.
    console.error('[Moodle Hoarder] Scan failed:', e);
    setStatus(t('status.error.with.message', { msg: e.message || String(e) }));
    $('scan').disabled = false;
  } finally {
    setSkeleton(false);
  }
});

async function scanCourse(courseUrl) {
  const res = await fetch(courseUrl, { credentials: 'include' });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const data = extractCourse(doc);
  data.courseUrl = courseUrl;
  data.prevSeen = await loadSeen(data.courseId);
  return data;
}

// Reads the live DOM from the active tab (so we see JS-rendered course cards).
// Polls until the course count is stable for ~1s, then returns the list.
async function scanCoursesInActiveTab(tabId) {
  let lastCount = -1, stable = 0;
  const start = Date.now();
  while (Date.now() - start < 6000) {
    let courses = [];
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const out = [];
          const seen = new Set();
          for (const a of document.querySelectorAll('a[href*="/course/view.php?id="]')) {
            const m = a.href.match(/[?&]id=(\d+)/);
            if (!m) continue;
            const id = m[1];
            if (seen.has(id)) continue;
            // Try multiple selectors used by Moodle 3.x / 4.x course cards.
            const nameCandidates = [
              a.querySelector('.coursename .multiline')?.textContent,
              a.querySelector('.coursename')?.textContent,
              a.querySelector('.course-info-container .coursename')?.textContent,
              a.querySelector('.text-truncate')?.textContent,
              a.querySelector('[aria-label]')?.getAttribute('aria-label'),
              a.getAttribute('aria-label'),
              a.title,
              a.textContent,
            ];
            const text = (nameCandidates.find(s => s && s.trim()) || '').trim();
            if (!text) continue;
            // Filter obvious non-course links (e.g. "View more", "More info")
            if (/^(view|more|פרטים|מידע נוסף|הצג עוד)$/i.test(text)) continue;
            seen.add(id);
            out.push({ id, name: text.replace(/\s+/g, ' '), url: a.href });
          }
          return out;
        },
      });
      courses = result || [];
    } catch {}
    if (courses.length === lastCount && courses.length > 0) {
      stable += 500;
      if (stable >= 1000) return courses;
    } else {
      stable = 0;
    }
    lastCount = courses.length;
    await new Promise(r => setTimeout(r, 500));
  }
  // Final attempt — return whatever we have even if not "stable"
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const out = [];
        const seen = new Set();
        for (const a of document.querySelectorAll('a[href*="/course/view.php?id="]')) {
          const m = a.href.match(/[?&]id=(\d+)/);
          if (!m || seen.has(m[1])) continue;
          const text = (
            a.querySelector('.coursename')?.textContent ||
            a.getAttribute('aria-label') ||
            a.title ||
            a.textContent || ''
          ).trim();
          if (!text) continue;
          seen.add(m[1]);
          out.push({ id: m[1], name: text.replace(/\s+/g, ' '), url: a.href });
        }
        return out;
      },
    });
    return result || [];
  } catch {
    return [];
  }
}

// ========== Extraction (works on any Document) ==========
function extractCourse(doc) {
  const courseName = (doc.querySelector('.page-header-headings h1, header h1, h1')?.textContent
                      || doc.title || 'course').trim();
  const courseId = (doc.querySelector('[data-courseid]')?.getAttribute('data-courseid'))
                 || (doc.querySelector('body')?.id?.match(/course-(\d+)/)?.[1])
                 || '';

  // Try to find proper sections
  const secEls = doc.querySelectorAll('li.section.main, li[id^="section-"], section.section.main, [data-region="course-section"]');
  const sections = [];
  let idx = 0;
  const seen = new Set();

  // Pull clean visible text from an element while stripping Moodle's UI
  // controls. textContent of a section header would otherwise include the
  // collapse/expand buttons ("צמצום"/"הרחבה"), the section-picker label
  // ("בחירת יחידת הוראה"), and the screen-reader-only span — turning
  // "שיעור 5" into a long mess.
  const cleanText = (el) => {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll(
      'button, select, input, [role="button"], [role="menu"], [role="menuitem"],' +
      ' .accesshide, .visually-hidden, .sr-only, [aria-hidden="true"],' +
      ' .dropdown, .dropdown-menu, .actions, .editing_section, .section-actions,' +
      ' .activity-actions, .activity-action-menu, .menu-action, .icon'
    ).forEach(n => n.remove());
    return clone.textContent.replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
  };

  const getSectionTitle = (sec) => {
    const candidates = [
      '[data-region="section-title"] [data-action="edit"]',
      '[data-region="section-title"] a',
      '[data-region="section-title"]',
      '.section-title-content .inplaceeditable',
      '.section-title-content',
      '.section-title',
      '.sectiontitle',
      'h3.sectionname > a',
      'h3.sectionname',
      '.sectionname',
      'h3',
    ];
    for (const sel of candidates) {
      const el = sec.querySelector(sel);
      if (!el) continue;
      const text = cleanText(el);
      if (text && text.length < 200) return text;
    }
    return '';
  };

  const getActivityName = (a) => {
    for (const sel of ['.instancename', '.activityname', '.activitytitle', '.aalink']) {
      const el = a.querySelector(sel);
      if (!el) continue;
      const text = cleanText(el);
      if (text) return text;
    }
    return cleanText(a);
  };

  const collect = (root, sectionName) => {
    const items = [];
    for (const a of root.querySelectorAll('a[href]')) {
      const m = a.href.match(ACTIVITY_RE);
      if (!m) continue;
      const key = m[1] + ':' + m[2];
      if (seen.has(key)) continue;
      seen.add(key);
      const name = getActivityName(a) || `${m[1]}_${m[2]}`;
      items.push({ idx: idx++, type: m[1], id: m[2], url: a.href, name, section: sectionName });
    }
    return items;
  };

  for (const sec of secEls) {
    const sName = getSectionTitle(sec) || `קטע ${sections.length + 1}`;
    const items = collect(sec, sName);
    if (items.length) {
      const sIdx = sections.length;
      for (const it of items) it.sectionIdx = sIdx;
      sections.push({ name: sName, items });
    }
  }

  if (!sections.length) {
    const all = collect(doc.body || doc, 'כללי');
    if (all.length) {
      for (const it of all) it.sectionIdx = 0;
      sections.push({ name: 'כללי', items: all });
    }
  }

  return { courseName, courseId, sections };
}

function extractCourses(doc) {
  const courses = [];
  const seen = new Set();
  // Course cards on /my/courses.php — match links to course/view.php?id=...
  for (const a of doc.querySelectorAll('a[href*="/course/view.php?id="]')) {
    const m = a.href.match(/[?&]id=(\d+)/);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    // Skip non-course links (navigation)
    const text = (a.querySelector('.coursename .multiline')?.textContent
                  || a.querySelector('.coursename')?.textContent
                  || a.getAttribute('aria-label')
                  || a.textContent || '').trim();
    if (!text) continue;
    seen.add(id);
    courses.push({ id, name: text, url: a.href });
  }
  return courses;
}

// ========== File size pre-scan (ROADMAP #19) ==========
// Format bytes as a short human label (e.g. "12.4MB", "850KB").
function formatBytes(n) {
  if (!n || n <= 0) return '';
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + 'KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + 'GB';
}

// HEAD pre-scan only handles types where the size is meaningful and cheap
// to discover (single file or single folder ZIP). For HTML-wrapped types
// like assign/page/book, the size is the sum of attached files and we'd
// have to scrape the page first — not worth it for a heads-up display.
const SIZE_PROBE_TYPES = new Set(['resource', 'folder']);

// Build the URL we should issue a HEAD against to learn an item's size.
function sizeProbeUrl(item) {
  if (item.type === 'resource') {
    return item.url + (item.url.includes('?') ? '&' : '?') + 'redirect=1';
  }
  if (item.type === 'folder') {
    try {
      const u = new URL(item.url);
      return `${u.origin}/mod/folder/download_folder.php?id=${item.id}`;
    } catch { return null; }
  }
  return null;
}

// Probe the size of one item via HEAD. Returns bytes (number) or null if
// the size could not be determined. Follows redirects (default fetch).
// Falls back to a ranged GET (bytes=0-0) when HEAD is rejected — some
// Moodle setups return 405 on HEAD but still report Content-Range on GET.
async function probeItemSize(item) {
  const url = sizeProbeUrl(item);
  if (!url) return null;
  try {
    let res = await fetch(url, { method: 'HEAD', credentials: 'include' });
    if (res.ok) {
      const cl = +res.headers.get('Content-Length');
      if (cl > 0) return cl;
    }
    // Fallback: ranged 1-byte GET. Server replies 206 with Content-Range:
    // "bytes 0-0/<total>". Cheap and tolerant of HEAD-blocking setups.
    res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Range': 'bytes=0-0' },
    });
    const cr = res.headers.get('Content-Range');
    const m = cr && cr.match(/\/(\d+)/);
    if (m) return +m[1];
    const cl = +res.headers.get('Content-Length');
    if (res.status === 200 && cl > 0) return cl;
  } catch {}
  return null;
}

// Runs probes for every probable item with a small concurrency pool so the
// popup doesn't fire 50 simultaneous requests on a large course. Calls
// `onSize(item, bytes)` per item — `bytes` may be null to mean "couldn't
// determine, stop showing the spinner for this row".
async function prefetchSizesForPicker(sections, onSize, onProgress) {
  const queue = [];
  for (const sec of sections) {
    for (const it of sec.items) {
      if (SIZE_PROBE_TYPES.has(it.type) && it.estimatedSize === undefined) {
        queue.push(it);
      }
    }
  }
  const total = queue.length;
  if (total === 0) return;
  let done = 0;
  const CONCURRENCY = 4;
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      const item = queue[next++];
      const size = await probeItemSize(item);
      // Stash on the item so a re-render (search/sort) doesn't re-probe.
      item.estimatedSize = (size == null) ? null : size;
      try { onSize(item, size); } catch {}
      done++;
      try { onProgress?.(done, total); } catch {}
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

// Updates one <li> in the picker to reflect a probed size.
//   bytes > threshold (when threshold set) → red chip + uncheck + 'oversized' class
//   bytes <= threshold or no threshold      → neutral chip with size label
//   bytes == null                           → no chip (probe failed silently)
function applySizeToLi(li, item, bytes) {
  if (!li) return;
  // Wipe any stale size chip from a previous render.
  li.querySelectorAll('.chip.size').forEach(c => c.remove());
  li.classList.remove('oversized');
  if (bytes == null) return;
  const chip = document.createElement('span');
  chip.className = 'chip size';
  chip.textContent = formatBytes(bytes);
  // Insert at the end (after type chip and any "new" chip)
  li.appendChild(chip);
  const maxMB = CACHED_SETTINGS?.maxFileSizeMB || 0;
  if (maxMB > 0 && bytes > maxMB * 1024 * 1024) {
    chip.classList.add('oversized');
    chip.title = t('size.over.tooltip', { mb: maxMB });
    li.classList.add('oversized');
    const cb = li.querySelector('input[type=checkbox]');
    if (cb && cb.checked) {
      cb.checked = false;
      // Section master + count need to refresh after auto-uncheck.
      const secDiv = li.closest('.section');
      if (secDiv) updateSectionMaster(secDiv);
      updateSelCount();
    }
  }
}

// ========== Picker rendering ==========
function renderPicker() {
  showView('picker');
  sectionsEl.innerHTML = '';

  let total = 0;
  scanned.sections.forEach((sec, sIdx) => {
    const secDiv = document.createElement('div');
    secDiv.className = 'section';
    secDiv.innerHTML = `
      <div class="section-header">
        <input type="checkbox" class="sec-master">
        <span class="sec-name"></span>
        <span class="sec-count"></span>
        <span class="caret">▼</span>
      </div>
      <ul class="section-items"></ul>`;
    secDiv.querySelector('.sec-name').textContent = sec.name;
    secDiv.querySelector('.sec-count').textContent = `${sec.items.length} פריטים`;
    const ul = secDiv.querySelector('.section-items');

    sec.items.forEach(item => {
      const defChecked = defaultChecked(item, sIdx);
      const status = diffStatus(scanned.prevSeen, item, defChecked);
      const li = document.createElement('li');
      li.dataset.idx = item.idx;
      li.dataset.type = item.type;
      li.innerHTML = `
        <input type="checkbox" ${defChecked ? 'checked' : ''}>
        <span class="name"></span>
        <span class="chip"></span>`;
      li.querySelector('.name').textContent = item.name;
      const chip = li.querySelector('.chip');
      chip.textContent = item.type;
      if (status && scanned.prevSeen) {
        const n = document.createElement('span');
        n.className = 'chip new';
        n.textContent = status;
        chip.after(n);
      }
      // If we already probed this item in a previous render, restore the
      // size chip immediately (no flicker on search/sort).
      if (item.estimatedSize != null) {
        applySizeToLi(li, item, item.estimatedSize);
      }
      li.querySelector('input').addEventListener('change', () => {
        updateSectionMaster(secDiv);
        updateSelCount();
      });
      ul.appendChild(li);
      total++;
    });

    // Section header behaviors
    const header = secDiv.querySelector('.section-header');
    const master = secDiv.querySelector('.sec-master');
    header.addEventListener('click', (e) => {
      if (e.target === master) return;
      secDiv.classList.toggle('collapsed');
    });
    master.addEventListener('click', (e) => e.stopPropagation());
    master.addEventListener('change', () => {
      ul.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = master.checked);
      updateSelCount();
    });
    updateSectionMaster(secDiv);
    sectionsEl.appendChild(secDiv);
  });

  totCountEl.textContent = total;

  // Banner priority: prior incomplete download (checkpoint) > diff banner
  (async () => {
    const ckpt = scanned.courseId ? await loadCheckpoint(scanned.courseId) : null;
    if (ckpt && Object.keys(ckpt.results || {}).length) {
      const cachedCount = Object.keys(ckpt.results).length;
      diffText.textContent = t('diff.checkpoint', { date: formatDateShort(ckpt.startedAt), n: cachedCount });
      diffBanner.classList.add('show');
      return;
    }
    if (scanned.prevSeen && scanned.prevSeen.items?.length) {
      const newCount = countNew();
      diffText.textContent = t('diff.previous', { date: formatDateShort(scanned.prevSeen.lastDownload), n: newCount });
      diffBanner.classList.add('show');
    } else {
      diffBanner.classList.remove('show');
    }
  })();

  updateSelCount();
  setStatus('');

  // Kick off the HEAD pre-scan in the background. Only runs when the user
  // configured a maxFileSizeMB — otherwise we don't bother with extra HTTP
  // chatter (the sizes are nice-to-have, not core data).
  const maxMB = CACHED_SETTINGS?.maxFileSizeMB || 0;
  if (maxMB > 0) {
    // Note: not reusing the top-level `statusEl` (#status) — this is a
    // dedicated indicator above the section list.
    const sizeStatusEl = document.getElementById('sizeScanStatus');
    if (sizeStatusEl) {
      sizeStatusEl.classList.add('show');
      sizeStatusEl.classList.remove('done');
      sizeStatusEl.style.color = '';
      sizeStatusEl.textContent = t('size.checking');
    }
    prefetchSizesForPicker(
      scanned.sections,
      (item, bytes) => {
        const li = sectionsEl.querySelector(`li[data-idx="${item.idx}"]`);
        if (li) applySizeToLi(li, item, bytes);
      },
      (done, total) => {
        if (sizeStatusEl) sizeStatusEl.textContent = t('size.checking.progress', { done, total });
      },
    ).then(() => {
      if (!sizeStatusEl) return;
      // Summarise oversized count after the scan finishes — keeps the user
      // informed when items got auto-unchecked.
      let over = 0;
      for (const sec of scanned.sections) {
        for (const it of sec.items) {
          if (it.estimatedSize && it.estimatedSize > maxMB * 1024 * 1024) over++;
        }
      }
      sizeStatusEl.classList.add('done');
      if (over > 0) {
        sizeStatusEl.textContent = t('size.summary.over', { n: over, mb: maxMB });
        sizeStatusEl.style.color = 'var(--err)';
      } else {
        sizeStatusEl.classList.remove('show');
      }
    }).catch(() => {
      if (sizeStatusEl) { sizeStatusEl.classList.remove('show'); sizeStatusEl.classList.remove('done'); }
    });
  }
}

// Cached settings — loaded once at popup boot. The settings page writes
// chrome.storage and we re-read; the popup only lives for short bursts so
// keeping a snapshot in memory is fine.
let CACHED_SETTINGS = null;
async function loadCachedSettings() {
  CACHED_SETTINGS = await getSettings();
  // Apply theme + accent on every popup open in case the user changed
  // them elsewhere.
  applyTheme(CACHED_SETTINGS.theme);
  applyAccent(CACHED_SETTINGS.accentColor);
  document.body.classList.toggle('mh-compact', !!CACHED_SETTINGS.compactMode);
  // Resolve & apply UI language (ROADMAP #16). For 'auto', sniff the
  // active Moodle tab's <html lang> via scripting; falls back gracefully
  // if the active tab isn't a Moodle page.
  let courseLang = null;
  if (CACHED_SETTINGS.uiLanguage === 'auto') {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && tab.url && /moodlearn\.ariel\.ac\.il/.test(tab.url)) {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.documentElement.getAttribute('lang') || '',
        });
        courseLang = result || null;
      }
    } catch {}
  }
  if (typeof applyLanguage === 'function') {
    applyLanguage(resolveLanguage(CACHED_SETTINGS.uiLanguage, courseLang));
  }
  return CACHED_SETTINGS;
}

function defaultChecked(item, sectionIdx) {
  // Settings file-type filter wins: if user disabled this type in options,
  // it is unchecked by default.
  const ft = CACHED_SETTINGS?.fileTypes;
  if (ft && ft[item.type] === false) return false;
  if (ALWAYS_OFF_TYPES.has(item.type)) return false;
  if (sectionIdx === 0 && INTRO_OFF_TYPES.has(item.type)) return false;
  return true;
}

function isPreviouslySeen(prev, item) {
  if (!prev || !prev.items) return false;
  return prev.items.some(p => p.type === item.type && p.id === item.id);
}

// Returns a chip label string for the diff status, or '' if no label needed.
// - 'חדש'        — item didn't exist in the previous download
// - 'לא בדיפולט' — was skipped last time because it's a default-off type
//                  (so it's not really "new", just non-default)
// - ''           — item is unchanged
// (Size-based "עודכן" will appear once we have per-item sizes — TODO.)
function diffStatus(prev, item, defChecked) {
  if (!prev || !prev.items?.length) return '';
  const seen = prev.items.find(p => p.type === item.type && p.id === item.id);
  if (seen) return '';
  // Not seen before — either truly new, or simply not part of the default selection.
  return defChecked ? t('diff.chip.new') : t('diff.chip.notdefault');
}

function countNew() {
  let n = 0;
  scanned.sections.forEach((sec, sIdx) => sec.items.forEach(it => {
    if (diffStatus(scanned.prevSeen, it, defaultChecked(it, sIdx)) === t('diff.chip.new')) n++;
  }));
  return n;
}

function updateSectionMaster(secDiv) {
  const boxes = secDiv.querySelectorAll('.section-items input[type=checkbox]');
  const m = secDiv.querySelector('.sec-master');
  const checked = [...boxes].filter(b => b.checked).length;
  m.checked = checked === boxes.length && boxes.length > 0;
  m.indeterminate = checked > 0 && checked < boxes.length;
}

function updateSelCount() {
  const n = sectionsEl.querySelectorAll('.section-items input[type=checkbox]:checked').length;
  selCountEl.textContent = n;
  $('download').disabled = n === 0;
}

// Selection helpers
$('selAll').addEventListener('click', () => {
  sectionsEl.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = true);
  sectionsEl.querySelectorAll('.section').forEach(updateSectionMaster);
  updateSelCount();
});
$('selNone').addEventListener('click', () => {
  sectionsEl.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = false);
  sectionsEl.querySelectorAll('.section').forEach(updateSectionMaster);
  updateSelCount();
});
$('selDefaults').addEventListener('click', () => {
  scanned.sections.forEach((sec, sIdx) => {
    sec.items.forEach(it => {
      const li = sectionsEl.querySelector(`li[data-idx="${it.idx}"]`);
      if (li) li.querySelector('input').checked = defaultChecked(it, sIdx);
    });
  });
  sectionsEl.querySelectorAll('.section').forEach(updateSectionMaster);
  updateSelCount();
});

// Toggle every section open / closed (ROADMAP #6)
$('expandAll').addEventListener('click', () => {
  const sections = sectionsEl.querySelectorAll('.section');
  const anyCollapsed = [...sections].some(s => s.classList.contains('collapsed'));
  sections.forEach(s => {
    if (anyCollapsed) s.classList.remove('collapsed');
    else s.classList.add('collapsed');
  });
});

// Search history (ROADMAP #10) — remember last N searches in storage and
// surface them as <datalist> suggestions on the picker search input.
const SEARCH_HISTORY_KEY = 'mh-search-history';
const SEARCH_HISTORY_MAX = 12;
async function loadSearchHistory() {
  try {
    const s = await chrome.storage.local.get(SEARCH_HISTORY_KEY);
    return s[SEARCH_HISTORY_KEY] || [];
  } catch { return []; }
}
async function pushSearchHistory(q) {
  q = (q || '').trim();
  if (!q || q.length < 2) return;
  const cur = await loadSearchHistory();
  const next = [q, ...cur.filter(x => x !== q)].slice(0, SEARCH_HISTORY_MAX);
  try { await chrome.storage.local.set({ [SEARCH_HISTORY_KEY]: next }); } catch {}
  renderSearchHistory(next);
}
function renderSearchHistory(arr) {
  const dl = document.getElementById('searchHistory');
  if (!dl) return;
  dl.innerHTML = '';
  for (const q of arr) {
    const opt = document.createElement('option');
    opt.value = q;
    dl.appendChild(opt);
  }
}
// Load history on boot and persist on change with a small debounce
loadSearchHistory().then(renderSearchHistory);
let searchSaveTimer = null;
searchEl.addEventListener('change', () => {
  clearTimeout(searchSaveTimer);
  searchSaveTimer = setTimeout(() => pushSearchHistory(searchEl.value), 400);
});
$('selOnlyNew').addEventListener('click', () => {
  scanned.sections.forEach(sec => sec.items.forEach(it => {
    const li = sectionsEl.querySelector(`li[data-idx="${it.idx}"]`);
    if (li) li.querySelector('input').checked = !isPreviouslySeen(scanned.prevSeen, it);
  }));
  sectionsEl.querySelectorAll('.section').forEach(updateSectionMaster);
  updateSelCount();
});
$('selAllInBanner').addEventListener('click', () => $('selAll').click());

searchEl.addEventListener('input', () => {
  const q = searchEl.value.toLowerCase().trim();
  sectionsEl.querySelectorAll('.section-items li').forEach(li => {
    const n = li.querySelector('.name').textContent.toLowerCase();
    li.classList.toggle('hidden', q && !n.includes(q));
  });
});

$('back').addEventListener('click', () => {
  showView('initial');
  $('scan').disabled = false;
  resetFooter();
});

// ========== Multi-course rendering ==========
// Pinning (ROADMAP #25 + #25.1) — `coursePins` is a Set of course IDs the
// user pinned manually; `courseClicks` tracks how often each course was
// downloaded so frequent ones float to the top automatically. Pinned
// courses always come before auto-sorted ones.
const PINS_KEY  = 'mh-course-pins';
const CLICKS_KEY = 'mh-course-clicks';

async function loadPins() {
  try {
    const s = await chrome.storage.local.get([PINS_KEY, CLICKS_KEY]);
    return { pins: new Set(s[PINS_KEY] || []), clicks: s[CLICKS_KEY] || {} };
  } catch { return { pins: new Set(), clicks: {} }; }
}
async function togglePin(courseId) {
  const { pins } = await loadPins();
  if (pins.has(courseId)) pins.delete(courseId);
  else pins.add(courseId);
  try { await chrome.storage.local.set({ [PINS_KEY]: [...pins] }); } catch {}
}
async function bumpCourseClick(courseId) {
  if (!courseId) return;
  const { clicks } = await loadPins();
  clicks[courseId] = (clicks[courseId] || 0) + 1;
  try { await chrome.storage.local.set({ [CLICKS_KEY]: clicks }); } catch {}
}

async function renderMulti() {
  showView('multi');
  coursesEl.innerHTML = '';
  const { pins, clicks } = await loadPins();
  // Sort: pinned first (alphabetically), then by descending click count,
  // then by original order for ties.
  const indexed = multiScanned.courses.map((c, i) => ({ ...c, _i: i }));
  indexed.sort((a, b) => {
    const ap = pins.has(a.id), bp = pins.has(b.id);
    if (ap !== bp) return ap ? -1 : 1;
    const ac = clicks[a.id] || 0, bc = clicks[b.id] || 0;
    if (ac !== bc) return bc - ac;
    return a._i - b._i;
  });
  totCoursesEl.textContent = indexed.length;
  for (const c of indexed) {
    const li = document.createElement('li');
    li.dataset.id = c.id;
    const isPinned = pins.has(c.id);
    li.innerHTML = `
      <input type="checkbox" checked>
      <div style="flex:1;overflow:hidden;">
        <div class="name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
        <div class="id">ID ${c.id}${(clicks[c.id] || 0) > 0 ? ` · ${clicks[c.id]} הורדות` : ''}</div>
      </div>
      <button class="mh-pin" title="${isPinned ? t('multi.pin.title') : t('multi.unpin.title')}" style="background:transparent;border:none;cursor:pointer;font-size:16px;width:auto;padding:4px;color:${isPinned ? 'var(--accent)' : 'var(--muted)'}">${isPinned ? '📌' : '📍'}</button>`;
    li.querySelector('.name').textContent = c.name;
    li.querySelector('input').addEventListener('change', updateCourseCount);
    li.querySelector('.mh-pin').addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await togglePin(c.id);
      renderMulti();
    });
    coursesEl.appendChild(li);
  }
  updateCourseCount();
}
function updateCourseCount() {
  const n = coursesEl.querySelectorAll('input[type=checkbox]:checked').length;
  $('downloadMulti').disabled = n === 0;
}
$('courseAll').addEventListener('click', () => {
  coursesEl.querySelectorAll('input').forEach(c => c.checked = true);
  updateCourseCount();
});
$('courseNone').addEventListener('click', () => {
  coursesEl.querySelectorAll('input').forEach(c => c.checked = false);
  updateCourseCount();
});
$('searchCourses').addEventListener('input', () => {
  const q = $('searchCourses').value.toLowerCase().trim();
  coursesEl.querySelectorAll('li').forEach(li => {
    const n = li.querySelector('.name').textContent.toLowerCase();
    li.style.display = (q && !n.includes(q)) ? 'none' : '';
  });
});
$('backMulti').addEventListener('click', () => {
  showView('initial');
  $('scan').disabled = false;
  resetFooter();
});

// ========== Zoom picker (after scrape, before URL resolution) ==========
function renderZoomPicker() {
  showView('zoom');
  const list = $('zoomItems');
  list.innerHTML = '';
  const recs = zoomScanned.data.recordings;
  $('totZoom').textContent = recs.length;
  for (const rec of recs) {
    const li = document.createElement('li');
    li.dataset.id = `${rec.meetingId || ''}|${rec.date || ''}|${(rec.topic || '').slice(0, 30)}`;
    const dateShort = (rec.date || '').slice(0, 22);
    const pageTag = zoomScanned.data.pages > 1 ? ` · p${rec.page}` : '';
    li.innerHTML = `
      <input type="checkbox" checked>
      <div style="flex:1;overflow:hidden;">
        <div class="name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
        <div class="id"></div>
      </div>`;
    li.querySelector('.name').textContent = rec.topic || '(ללא שם)';
    li.querySelector('.id').textContent = `${dateShort}${pageTag}`;
    li.querySelector('input').addEventListener('change', updateZoomCount);
    list.appendChild(li);
  }
  updateZoomCount();
  setStatus('');
}
function updateZoomCount() {
  const n = $('zoomItems').querySelectorAll('input[type=checkbox]:checked').length;
  $('selZoom').textContent = n;
  $('downloadZoomLinks').disabled = n === 0;
  $('downloadZoomVideos').disabled = n === 0;
}
$('zoomAll').addEventListener('click', () => {
  $('zoomItems').querySelectorAll('li:not([style*="display: none"]) input').forEach(c => c.checked = true);
  updateZoomCount();
});
$('zoomNone').addEventListener('click', () => {
  $('zoomItems').querySelectorAll('li:not([style*="display: none"]) input').forEach(c => c.checked = false);
  updateZoomCount();
});
$('searchZoom').addEventListener('input', () => {
  const q = $('searchZoom').value.toLowerCase().trim();
  $('zoomItems').querySelectorAll('li').forEach(li => {
    const t = li.querySelector('.name').textContent.toLowerCase()
            + ' ' + li.querySelector('.id').textContent.toLowerCase();
    li.style.display = (q && !t.includes(q)) ? 'none' : '';
  });
});
$('backZoom').addEventListener('click', () => {
  showView('initial');
  $('scan').disabled = false;
  resetFooter();
  zoomScanned = null;
});

// Returns the currently-checked recordings in the Zoom picker.
function zoomGetSelected() {
  if (!zoomScanned) return [];
  const allRecs = zoomScanned.data.recordings;
  const checkedIds = new Set();
  $('zoomItems').querySelectorAll('li').forEach(li => {
    if (li.querySelector('input').checked) checkedIds.add(li.dataset.id);
  });
  return allRecs.filter(r =>
    checkedIds.has(`${r.meetingId || ''}|${r.date || ''}|${(r.topic || '').slice(0, 30)}`));
}

// Resolves share URLs for the selected recordings (the slow JWT step).
// Caches on each recording so clicking a second button doesn't re-resolve.
// Returns { withUrls, ok, debugHtml }.
async function zoomEnsureResolved(selected) {
  const alreadyAll = selected.every(r => r.shareUrls?.length || r._resolveAttempted);
  let debugHtml = null;
  if (!alreadyAll) {
    setStatus(t('status.zoom.start', { n: selected.length }));
    debugHtml = await resolveZoomPlayUrls(zoomScanned.tabId, selected, (s) => setStatus(s));
    for (const r of selected) r._resolveAttempted = true;
  }
  const withUrls = selected.filter(r => r.shareUrls?.length);
  return { withUrls, ok: withUrls.length, debugHtml };
}

// 📄 Button: links + transcripts only (the fast path). Produces the ZIP.
$('downloadZoomLinks').addEventListener('click', async () => {
  if (!zoomScanned) return;
  const selected = zoomGetSelected();
  if (!selected.length) return;
  $('downloadZoomLinks').disabled = true;
  $('downloadZoomVideos').disabled = true;
  $('backZoom').disabled = true;
  try {
    const { withUrls, ok, debugHtml } = await zoomEnsureResolved(selected);
    const outData = { ...zoomScanned.data, recordings: selected };

    if (ok === 0 && debugHtml) {
      const date = new Date().toISOString().slice(0, 10);
      const dumpBlob = new Blob([
        `<!-- Source URL: ${debugHtml.sourceUrl} -->\n<!-- Captured: ${new Date().toISOString()} -->\n`,
        debugHtml.html,
      ], { type: 'text/html;charset=utf-8' });
      await chrome.downloads.download({
        url: URL.createObjectURL(dumpBlob),
        filename: `zoom-detail-debug_${date}.html`,
        saveAs: false,
      });
      setStatus(t('status.zoom.no.urls'));
    } else {
      setStatus(t('status.zoom.results', { ok, total: selected.length }));
    }

    const wantTranscripts = (CACHED_SETTINGS?.extractTranscripts !== false) && withUrls.length > 0;
    const debugChk = document.getElementById('zoomDebugNetwork');

    if (wantTranscripts) {
      const concurrency = Math.max(1, +(CACHED_SETTINGS?.transcriptConcurrency || 3));
      const fmt = CACHED_SETTINGS?.transcriptFormats || 'txt';
      setStatus(`📝 מחלץ תמלילים מ-${withUrls.length} הקלטות (${concurrency} במקביל). הקלטות בלי תמליל ידלגו אחרי 8 שניות.`);
      let transcripts = [];
      try {
        transcripts = await extractZoomTranscripts(
          withUrls.map(r => ({ url: r.shareUrls[0], topic: r.topic, date: r.date, meetingId: r.meetingId })),
          (done, total, rec) => setStatus(`📝 (${done}/${total}) ${rec.topic || rec.url}`),
          concurrency,
        );
      } catch (e) {
        setStatus('📝 שגיאה בחילוץ תמלילים: ' + e.message);
        transcripts = [];
      }
      const files = [];
      files.push({ path: 'הקלטות.txt', blob: new Blob(['﻿' + buildZoomRecordingsText(outData)], { type: 'text/plain;charset=utf-8' }) });
      const summary = [];
      summary.push('Moodle Hoarder — Zoom Transcripts');
      summary.push('===================================');
      summary.push(`Captured at: ${new Date().toISOString()}`);
      summary.push(`Total recordings: ${transcripts.length}`);
      summary.push(`With transcript: ${transcripts.filter(tt => tt.vtt).length}`);
      summary.push(`No transcript UI: ${transcripts.filter(tt => tt.skipReason === 'no-transcript-ui').length}`);
      summary.push(`Timed out: ${transcripts.filter(tt => tt.skipReason === 'timeout').length}`);
      summary.push(`Format: ${fmt}`);
      summary.push('');
      let okT = 0;
      for (const tres of transcripts) {
        const baseName = transcriptFileStem(tres.recording);
        if (tres.vtt) {
          if (fmt !== 'txt') files.push({ path: `${baseName}.vtt`, blob: new Blob([tres.vtt], { type: 'text/vtt;charset=utf-8' }) });
          if (fmt !== 'vtt') files.push({ path: `${baseName}.txt`, blob: new Blob(['﻿' + tres.txt], { type: 'text/plain;charset=utf-8' }) });
          summary.push(`✓ ${baseName}  (VTT ${tres.vtt.length}B, TXT ${tres.txt.length}B)`);
          okT++;
        } else {
          summary.push(`✗ ${baseName}  — ${tres.error || 'unknown'}`);
        }
      }
      files.push({ path: '_status.txt', blob: new Blob(['﻿' + summary.join('\r\n')], { type: 'text/plain;charset=utf-8' }) });
      const zipBlob = await buildZip(files);
      const date = new Date().toISOString().slice(0, 10);
      const zipName = zoomZipFilename(withUrls, date);
      await chrome.downloads.download({ url: URL.createObjectURL(zipBlob), filename: zipName, saveAs: !!CACHED_SETTINGS?.saveAs });
      await appendDownloadHistory({
        type: 'zoom-links', title: zoomHistoryTitle(withUrls), sourceUrl: zoomScanned.data?.pageUrl || '',
        startedAt: Date.now(), finishedAt: Date.now(), status: okT === transcripts.length ? 'success' : 'partial',
        itemCount: transcripts.length, successCount: okT, failedCount: transcripts.length - okT, bytes: zipBlob.size, filename: zipName,
      });
      setStatus(`✅ ${zipName} — ${okT}/${transcripts.length} תמלילים חולצו.`);
      notify('Moodle Hoarder', `Zoom: ${okT}/${transcripts.length} תמלילים, ${ok} URLs`);
    } else {
      // Transcripts off — just save the links text file.
      await saveZoomFile(outData);
      notify('Moodle Hoarder', `Zoom: ${ok}/${selected.length} קישורים נחלצו`);
    }

    // Debug capture (only when checkbox ticked).
    if (debugChk?.checked && withUrls.length) {
      const debugTargets = withUrls.slice(0, 2);
      setStatus(`🎬 תלכוד network ל-${debugTargets.length} הקלטות (~25 שניות לכל אחת)...`);
      try {
        const debugData = await captureZoomNetworkDebug(
          debugTargets.map(r => ({ url: r.shareUrls[0], topic: r.topic, date: r.date })),
          (i, total, rec) => setStatus(`🎬 (${i + 1}/${total}) ${rec.topic || rec.url} — מנגן 20 שניות`),
        );
        const blob = new Blob([JSON.stringify(debugData, null, 2)], { type: 'application/json' });
        const date = new Date().toISOString().slice(0, 10);
        await chrome.downloads.download({ url: URL.createObjectURL(blob), filename: `zoom-network-debug_${date}.json`, saveAs: true });
        setStatus(`🎬 קובץ debug ירד.`);
      } catch (e) {
        setStatus('🎬 שגיאת תלכוד: ' + e.message);
      }
    }
  } finally {
    $('downloadZoomLinks').disabled = false;
    $('downloadZoomVideos').disabled = false;
    $('backZoom').disabled = false;
  }
});

// 🎥 Button: download the actual recording MP4 files.
$('downloadZoomVideos').addEventListener('click', async () => {
  if (!zoomScanned) return;
  const selected = zoomGetSelected();
  if (!selected.length) return;
  $('downloadZoomLinks').disabled = true;
  $('downloadZoomVideos').disabled = true;
  $('backZoom').disabled = true;
  try {
    const { withUrls, ok } = await zoomEnsureResolved(selected);
    if (withUrls.length === 0) {
      setStatus('🎥 לא הצלחתי לחלץ קישורי share — אי אפשר להוריד וידאו. נסה שוב או בדוק שאתה מחובר ל-Zoom.');
      return;
    }
    // The signed CloudFront MP4 serves video to fetch() but chrome.downloads
    // gets an HTML 403 (proven by the diagnostic download-probe). So we hand
    // each recording to the background worker, which opens the playback page,
    // captures the signed URL, fetch()es it IN the page (correct cookies/CORS),
    // and saves it via a blob anchor. Runs in the SW so it survives popup close.
    // V2 intentionally exposes no quality chooser: Zoom often provides only one
    // downloadable MP4, so we always request the best candidate it exposes.
    const dlList = withUrls.map(r => ({
      playUrl: r.shareUrls[0], filename: transcriptFileStem(r) + '.mp4', topic: r.topic || '', date: r.date || '',
    }));
    setProgress(0, dlList.length);
    const title = zoomHistoryTitle(withUrls);
    chrome.runtime.sendMessage({
      type: 'mh-download-recs', jobs: dlList, courseName: title, sourceUrl: zoomScanned.data?.pageUrl || '',
    });
    setStatus(`🎥 ${dlList.length} הורדות נכנסו לתור. ההורדה רצה ברקע אחת בכל פעם — אפשר לסגור את הפופאפ.`);
    notify('Moodle Hoarder', `Zoom: ${dlList.length} הורדות וידאו בתור`);
  } finally {
    $('downloadZoomLinks').disabled = false;
    $('downloadZoomVideos').disabled = false;
    $('backZoom').disabled = false;
  }
});

// ========== Zoom diagnostic ==========
// A self-contained, step-by-step tracer for the whole video pipeline.
// Unlike captureZoomNetworkDebug (which only runs AFTER resolve succeeds),
// this runs regardless of success and snapshots the DOM at every stage,
// so we can see exactly WHERE the flow breaks even when nothing downloads.
// It calls the existing resolver helpers read-only (golden rule #1: never
// modify them) and records what they return.

// Rich per-frame snapshot of whatever page the tab is currently showing.
// Captured at each stage so we can compare list vs. detail vs. player.
async function inspectZoomFrames(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const clip = (s, n = 200) => (s || '').toString().replace(/\s+/g, ' ').trim().slice(0, n);
        const ZOOM_ID_RE = /\b\d{3,4}\s+\d{3,4}\s+\d{3,4}\b/;
        // Tables (the resolver clicks rows inside a table that has a zoom id).
        const tables = [...document.querySelectorAll('table')].map(tbl => {
          const rows = [...tbl.querySelectorAll('tbody tr')];
          return {
            rowCount: rows.length,
            hasZoomId: rows.some(r => ZOOM_ID_RE.test(r.textContent || '')),
            headerText: clip(tbl.querySelector('thead')?.textContent || '', 300),
            firstRowText: clip(rows[0]?.textContent || '', 300),
            firstRowHasLink: !!rows[0]?.querySelector('a[href]:not([href="#"]):not([href^="javascript"])'),
            firstRowHasButton: !!rows[0]?.querySelector('button:not([disabled]), [role="button"]'),
          };
        });
        // Play-button-like elements (the detail page click target).
        const playLike = [];
        const seen = new Set();
        for (const el of document.querySelectorAll('button, [role="button"], a, [class*="play" i], [aria-label*="play" i], [title*="play" i]')) {
          if (seen.has(el)) continue; seen.add(el);
          const cls = (el.className && el.className.toString) ? el.className.toString() : '';
          const al = el.getAttribute?.('aria-label') || '';
          const ti = el.getAttribute?.('title') || '';
          const tx = clip(el.textContent, 40);
          if (/play/i.test(cls + ' ' + al + ' ' + ti + ' ' + tx) || /הפעל/.test(al + ' ' + ti + ' ' + tx)) {
            playLike.push({ tag: el.tagName, class: clip(cls, 140), ariaLabel: al, title: ti, text: tx, visible: el.offsetParent !== null });
          }
        }
        // Known selectors the resolver depends on — does each match right now?
        const sel = (s) => document.querySelectorAll(s).length;
        const knownSelectors = {
          '.lti-recording-item-play-media': sel('.lti-recording-item-play-media'),
          '[class*="play-media"]': sel('[class*="play-media"]'),
          '[title="Play"]': sel('[title="Play"]'),
          '.play-control': sel('.play-control'),
          '.ant-pagination': sel('.ant-pagination'),
          '.ant-breadcrumb': sel('.ant-breadcrumb'),
          'video': sel('video'),
          'source': sel('source'),
        };
        // Zoom recording URLs visible anywhere in the DOM.
        const recUrls = new Set();
        for (const a of document.querySelectorAll('a[href]')) {
          if (/zoom\.us\/(?:rec|recording)\//.test(a.href)) recUrls.add(a.href);
        }
        const bodyText = (document.body?.innerText || '');
        return {
          frameUrl: location.href,
          title: document.title,
          isZoom: /zoom\.us/.test(location.href),
          bodyChars: bodyText.length,
          looksLikeLogin: /sign in|log ?in|signin|התחבר|נא להתחבר/i.test(bodyText.slice(0, 4000)),
          tableCount: tables.length,
          tables,
          ariaRowCount: document.querySelectorAll('[role="row"]').length,
          knownSelectors,
          playLikeCount: playLike.length,
          playLike: playLike.slice(0, 15),
          recUrlsOnPage: [...recUrls].slice(0, 10),
          pagination: {
            present: !!document.querySelector('.ant-pagination'),
            active: clip(document.querySelector('.ant-pagination-item-active')?.textContent || '', 10),
            nextDisabled: !!document.querySelector('.ant-pagination-next.ant-pagination-disabled'),
          },
          bodySnippet: clip(bodyText, 1500),
        };
      },
    });
    return results.map(r => r?.result).filter(Boolean);
  } catch (e) {
    return [{ error: String(e) }];
  }
}

// Phase B probe: open a share/play URL in a hidden tab, install an
// UNFILTERED network monitor (captures every URL the player touches, not
// just ssrweb .mp4 like the real extractor), click play, and collect what
// the player actually loads — so we can see whether a signed MP4 ever
// appears and, if not, what it uses instead (HLS, blob, MSE, nothing).
async function probePlayerNetwork(shareUrl, onProgress) {
  let tab = null;
  const SETTLE = 3500, HARD = 25000;
  try {
    tab = await chrome.tabs.create({ url: shareUrl, active: false });
    await new Promise(r => setTimeout(r, SETTLE));
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN',
      func: () => {
        if (window.__mhDiagNet) return;
        window.__mhDiagNet = true;
        window.__mhDiagUrls = [];
        const rem = (s, via) => {
          if (!s || typeof s !== 'string') return;
          if (s.startsWith('data:')) return;
          window.__mhDiagUrls.push({ via, url: s.slice(0, 4000), blob: s.startsWith('blob:') });
        };
        const scan = () => { for (const v of document.querySelectorAll('video, source')) rem(v.currentSrc || v.src || v.getAttribute('src'), 'media-src'); };
        new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
        scan();
        const of = window.fetch;
        window.fetch = function (...a) { rem(typeof a[0] === 'string' ? a[0] : (a[0]?.url || ''), 'fetch'); return of.apply(this, a); };
        const oo = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (m, u) { rem(u, 'xhr'); return oo.apply(this, arguments); };
      },
    });
    // Try to click play (same selector set as the real extractor).
    const [{ result: playResult }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN',
      func: () => {
        const candidates = [
          '.play-control', '.zm-control-button-play', 'button.play-button',
          '[aria-label="Play" i]', '[aria-label="הפעל" i]', '[title="Play" i]',
          'button[data-tracking-id*="play" i]', '.center-play-btn',
          '.vjs-play-control', 'div[role="button"][aria-label*="play" i]',
          '.lti-recording-item-play-media', '[class*="play-media"]',
        ];
        for (const s of candidates) {
          const el = document.querySelector(s);
          if (el && !el.disabled) { try { el.click(); return { clicked: true, selector: s }; } catch {} }
        }
        for (const b of document.querySelectorAll('button')) {
          const tx = (b.textContent || '').trim().toLowerCase();
          if (tx === 'play' || tx === 'הפעל') { try { b.click(); return { clicked: true, selector: 'button:text=play' }; } catch {} }
        }
        return { clicked: false, selector: null };
      },
    });
    // Poll for captured URLs.
    const start = Date.now();
    let urls = [];
    while (Date.now() - start < HARD) {
      await new Promise(r => setTimeout(r, 800));
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN',
          func: () => window.__mhDiagUrls || [],
        });
        urls = result || [];
      } catch {}
      onProgress?.(urls.length, Math.round((Date.now() - start) / 1000));
      if (urls.length > 0 && Date.now() - start > SETTLE + 6000) break;
    }
    // Dedupe + classify.
    const seen = new Set();
    const uniq = [];
    for (const u of urls) { const k = u.url; if (!seen.has(k)) { seen.add(k); uniq.push(u); } }
    const classify = {
      signedMp4: uniq.filter(u => /ssrweb\.zoom\.us/i.test(u.url) && /\.mp4/i.test(u.url) && !u.blob),
      anyMp4: uniq.filter(u => /\.mp4/i.test(u.url)),
      hls: uniq.filter(u => /\.m3u8/i.test(u.url)),
      blobSources: uniq.filter(u => u.blob),
      ssrweb: uniq.filter(u => /ssrweb\.zoom\.us/i.test(u.url)),
    };
    return { playResult, urlCount: uniq.length, classification: classify, allUrls: uniq.slice(0, 120) };
  } catch (e) {
    return { error: String(e) };
  } finally {
    if (tab?.id) { try { await chrome.tabs.remove(tab.id); } catch {} }
  }
}

// Orchestrator: walks list → detail → share URL → player network, tracing
// each step. Operates on the FIRST row of whatever list page is showing.
async function runZoomVideoDiagnostic(tabId, onProgress) {
  const t0 = Date.now();
  const trace = {
    schema: 'moodle-hoarder.zoom-diagnostic.v2',
    version: (chrome.runtime.getManifest?.().version) || '?',
    startedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    steps: [],
    summary: {},
  };
  const step = (name, data) => { trace.steps.push({ name, atMs: Date.now() - t0, ...data }); return data; };

  // Step 1 — list page as it stands now.
  onProgress?.('1/6 צילום דף הרשימה...');
  const listFrames = await inspectZoomFrames(tabId);
  step('list-page', { frames: listFrames });
  const listFrame = listFrames.find(f => f.tableCount > 0 && f.tables.some(t => t.hasZoomId))
                 || listFrames.find(f => f.isZoom) || listFrames[0] || {};
  trace.summary.foundRecordingsTable = !!(listFrame.tables && listFrame.tables.some(t => t.hasZoomId));
  trace.summary.frameCount = listFrames.length;
  if (listFrames.some(f => f.looksLikeLogin)) trace.summary.warnLogin = 'דף נראה כמו מסך התחברות — ייתכן שאינך מחובר ל-Zoom.';

  // Step 2 — click first row (real resolver helper).
  onProgress?.('2/6 לחיצה על השורה הראשונה...');
  const clicked = await clickRecordingRow(tabId, 0);
  step('click-row', { rowIndex: 0, clicked });
  trace.summary.rowClickWorked = clicked;

  // Step 3 — detail page.
  onProgress?.('3/6 המתנה לדף הפרטים...');
  const detail = await waitForDetailPage(tabId, 9000);
  await new Promise(r => setTimeout(r, 600));
  const detailFrames = await inspectZoomFrames(tabId);
  step('detail-page', { detailUrl: detail.url, urlsOnDetail: detail.urls, frames: detailFrames });
  trace.summary.detailPlayButtonFound = detailFrames.some(f =>
    f.knownSelectors && (f.knownSelectors['.lti-recording-item-play-media'] || f.knownSelectors['[class*="play-media"]'] || f.knownSelectors['[title="Play"]']));

  // Step 4 — click play & capture share URL (real resolver helper).
  onProgress?.('4/6 לחיצה על Play וחילוץ קישור share...');
  let shareUrls = detail.urls || [];
  let capturedFromPlay = [];
  if (!shareUrls.length) {
    capturedFromPlay = await clickPlayAndCaptureUrl(tabId);
    if (capturedFromPlay.length) shareUrls = capturedFromPlay;
  }
  step('capture-share-url', { fromDetailScrape: detail.urls || [], fromPlayClick: capturedFromPlay, resolved: shareUrls });
  trace.summary.shareUrlResolved = shareUrls.length > 0;
  trace.summary.shareUrlSample = shareUrls[0] || null;

  // Step 5 — go back so the list is restored.
  onProgress?.('5/6 חזרה לרשימה...');
  await navigateBackInZoom(tabId);
  await waitForListPage(tabId, 6000).catch(() => {});

  // Step 6 — probe the player network on the resolved share URL.
  if (shareUrls.length) {
    onProgress?.('6/6 בדיקת רשת של הנגן (פותח טאב נסתר, ~25 שניות)...');
    const probe = await probePlayerNetwork(shareUrls[0], (n, secs) => onProgress?.(`6/6 בדיקת נגן — נתפסו ${n} כתובות (${secs} שניות)`));
    step('player-network-probe', probe);
    const signed = probe.classification?.signedMp4 || [];
    trace.summary.signedMp4Found = signed.length > 0;
    trace.summary.playerUsesHls = !!(probe.classification && probe.classification.hls && probe.classification.hls.length);

    // Step 7 — download probe: actually fetch the first bytes of the signed
    // MP4 the way the download will, WITH and WITHOUT the referer rule, so we
    // can see whether the CDN returns video bytes or an HTML 403 page (the
    // .htm "File wasn't available" symptom). This confirms the referer fix.
    if (signed.length) {
      const testUrl = signed[0].url;
      // The signed URL is self-authorizing (referer/cookies irrelevant — both
      // were proven equal in earlier traces). One fetch tells us if the full
      // URL serves video. credentials:'include' is fine here: the probe runs
      // in the popup, where host_permissions bypass CORS entirely.
      onProgress?.('7/7 בדיקת הורדה (fetch על ה-URL המלא)...');
      let probe;
      try {
        const r = await fetch(testUrl, { method: 'GET', credentials: 'include', headers: { Range: 'bytes=0-1' } });
        const ct = r.headers.get('content-type') || '';
        let bodyStart = '';
        try { bodyStart = (await r.clone().text()).slice(0, 300); } catch {}
        const isVideo = /video|octet-stream|mp4/i.test(ct);
        probe = { status: r.status, ok: r.ok, contentType: ct, contentLength: r.headers.get('content-length'), isVideo, errorBody: isVideo ? undefined : bodyStart };
      } catch (e) { probe = { error: String(e) }; }
      step('download-probe', { urlFull: testUrl, urlLen: testUrl.length, result: probe });
      trace.summary.downloadServesVideo = !!(probe.ok && probe.isVideo);
    }
  } else {
    step('player-network-probe', { skipped: 'no share URL to probe' });
    trace.summary.signedMp4Found = false;
  }

  // Verdict — a plain-language diagnosis at the top of the file.
  const s = trace.summary;
  let verdict;
  if (!s.foundRecordingsTable) {
    verdict = s.warnLogin
      ? 'לא נמצאה טבלת הקלטות, והדף נראה כמו מסך התחברות. ככל הנראה אינך מחובר ל-Zoom, או שצריך לפתוח מחדש את דף ההקלטות.'
      : 'לא נמצאה טבלת הקלטות בדף הנוכחי. ייתכן שניווטת מדף ההקלטות, או שמבנה ה-DOM של Zoom השתנה (ראה list-page.frames).';
  } else if (!s.rowClickWorked) {
    verdict = 'נמצאה טבלה אך לחיצה על השורה נכשלה — ייתכן שמבנה השורה/הקישור השתנה (ראה list-page.frames[].tables).';
  } else if (!s.detailPlayButtonFound && !s.shareUrlResolved) {
    verdict = 'נכנסנו לדף הפרטים אך כפתור ה-Play לא זוהה ולא נתפס קישור — סביר ש-class-ים של כפתור ה-Play השתנו (ראה detail-page.frames[].playLike).';
  } else if (!s.shareUrlResolved) {
    verdict = 'כפתור Play זוהה אך לחיצה עליו לא חשפה קישור share (window.open לא נתפס). ראה capture-share-url.';
  } else if (!s.signedMp4Found) {
    verdict = s.playerUsesHls
      ? 'הקישור נחלץ, אך הנגן משתמש ב-HLS (m3u8) ולא ב-MP4 ישיר — צריך לוגיקת הורדה אחרת. ראה player-network-probe.classification.'
      : 'הקישור נחלץ אך לא נתפס signed MP4 מ-ssrweb. ייתכן שהנגן לא נטען בטאב רקע, ה-URL פג, או שהפורמט השתנה. ראה player-network-probe.allUrls.';
  } else if (s.downloadServesVideo === false) {
    verdict = 'נמצא signed MP4, אבל fetch ל-URL המלא לא מחזיר וידאו. ראה download-probe.result.errorBody — הוא מכיל את הודעת השגיאה המדויקת של S3/CloudFront (AccessDenied / Missing Key-Pair-Id / Request has expired). זה יגיד אם חסר חלק מה-URL, אם פג, או אם צריך להביא מהקשר הדף.';
  } else if (s.downloadServesVideo) {
    verdict = '✅ הכל תקין: טבלה ✓, קליק ✓, דף פרטים ✓, קישור share ✓, signed MP4 ✓, וה-fetch על ה-URL המלא מחזיר וידאו ✓. 🎥 מוריד דרך fetch-בדף → blob (background worker). אם לא ירד — בדוק את ה-Console של ה-service worker.';
  } else {
    verdict = 'נמצא signed MP4 אך בדיקת ההורדה לא הושלמה. ראה download-probe / player-network-probe לפרטים.';
  }
  trace.summary.verdict = verdict;
  return trace;
}

// 🩺 Button: run the full pipeline diagnostic and save a JSON report.
$('zoomDiagnose').addEventListener('click', async () => {
  if (!zoomScanned) { setStatus('🩺 קודם סרוק דף הקלטות Zoom.'); return; }
  const btns = ['downloadZoomLinks', 'downloadZoomVideos', 'backZoom', 'zoomDiagnose'];
  btns.forEach(id => { const b = $(id); if (b) b.disabled = true; });
  setStatus('🩺 מריץ דיאגנוסטיקה — אל תסגור את הפופאפ...');
  let trace;
  try {
    trace = await runZoomVideoDiagnostic(zoomScanned.tabId, (s) => setStatus('🩺 ' + s));
  } catch (e) {
    trace = { schema: 'moodle-hoarder.zoom-diagnostic.v2', fatalError: String(e), stack: e?.stack || null };
  }
  const json = JSON.stringify(trace, null, 2);
  const verdict = trace?.summary?.verdict || trace?.fatalError || 'הסתיים';
  // 1) Console — survives even if the popup closes.
  console.log('===== MOODLE HOARDER — ZOOM DIAGNOSTIC =====');
  console.log('VERDICT:', verdict);
  console.log(json);
  // 2) Show in the popup itself — the bulletproof path, no download needed.
  const out = $('zoomDiagOut');
  const resultBox = $('zoomDiagResult');
  if (out && resultBox) {
    out.value = json;
    resultBox.style.display = 'block';
    try { out.focus(); out.select(); } catch {}
  }
  // 3) Silent download (saveAs:false — a save dialog steals focus and closes
  //    the popup, which revokes the blob URL and cancels the download; that
  //    was why nothing downloaded before).
  let dlOk = false;
  try {
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await chrome.downloads.download({ url: URL.createObjectURL(blob), filename: `zoom-diagnostic_${stamp}.json`, saveAs: false });
    dlOk = true;
  } catch {}
  setStatus('🩺 ' + verdict + (dlOk ? ' — הקובץ ירד לתיקיית ההורדות, וגם מוצג למטה להעתקה.' : ' — מוצג למטה: לחץ "העתק הכל" ושלח לי.'));
  btns.forEach(id => { const b = $(id); if (b) b.disabled = false; });
});

// Copy the diagnostic JSON to the clipboard.
$('zoomDiagCopy')?.addEventListener('click', async () => {
  const out = $('zoomDiagOut');
  if (!out) return;
  try {
    await navigator.clipboard.writeText(out.value);
    setStatus('🩺 הועתק ללוח. הדבק לי כאן בצ׳אט.');
  } catch {
    out.focus(); out.select();
    try { document.execCommand('copy'); setStatus('🩺 הועתק ללוח.'); }
    catch { setStatus('🩺 בחר הכל בתיבה (Ctrl+A) והעתק ידנית (Ctrl+C).'); }
  }
});

$('zoomResearch')?.addEventListener('click', async () => {
  if (!zoomScanned) { setStatus('🔬 קודם סרוק דף הקלטות Zoom.'); return; }
  if (!chrome.debugger) { setStatus('🔬 הרשאת debugger חסרה — טען מחדש את התוסף ב-chrome://extensions.'); return; }
  const selected = zoomGetSelected();
  if (!selected.length) { setStatus('🔬 בחר לפחות הקלטה אחת.'); return; }
  $('zoomResearch').disabled = true;
  try {
    // Resolve the share URL here (uses hidden tabs, so the popup stays open),
    // then hand the heavy part to the background service worker. The worker
    // opens a FOCUSED tab (which closes the popup) and attaches the debugger —
    // running it in the worker means popup closing no longer kills the run.
    setStatus('🔬 מחלץ קישור share להקלטה הראשונה...');
    const { withUrls } = await zoomEnsureResolved([selected[0]]);
    if (!withUrls.length) {
      setStatus('🔬 לא הצלחתי לחלץ קישור share — אי אפשר לחקור. נסה 🩺 דיאגנוסטיקה לשלב הזה.');
      return;
    }
    const shareUrl = withUrls[0].shareUrls[0];
    await chrome.storage.local.remove('mhLastResearch').catch(() => {});
    chrome.runtime.sendMessage({ type: 'mh-deep-research', shareUrl, topic: selected[0].topic || '' });
    setStatus('🔬 המחקר רץ ברקע — ייפתח טאב והנגן ינוגן (~30 שניות). אל תסגור את הטאב. כשתסתיים תופיע התראה ויירד קובץ zoom-deep-research_*.json — פתח אותו ושלח לי. (גם יוצג כאן אם תפתח שוב את הפופאפ במסך ה-Zoom.)');
  } catch (e) {
    setStatus('🔬 שגיאה: ' + e.message);
  } finally {
    $('zoomResearch').disabled = false;
  }
});

// When the background worker stores a finished research result, show it in the
// textarea if the Zoom view is currently open (a convenience on top of the
// downloaded file + notification the worker produces).
function mhShowResearchResult(rec) {
  const out = $('zoomDiagOut'), box = $('zoomDiagResult');
  if (!out || !box || !rec) return;
  if (rec.status === 'running') { setStatus('🔬 המחקר עדיין רץ ברקע...'); return; }
  if (rec.json) {
    out.value = rec.json;
    box.style.display = 'block';
    setStatus('🔬 ' + (rec.foundPlayingMediaUrl ? 'נמצאה בקשת וידאו מנגנת!' : 'המחקר הסתיים') + ' — לחץ 📋 העתק הכל ושלח לי (או שלח את הקובץ שירד).');
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.mhLastResearch?.newValue) mhShowResearchResult(changes.mhLastResearch.newValue);
  if (changes.mhDlStatus?.newValue) renderZoomVideoStatus(changes.mhDlStatus.newValue);
});
chrome.storage.local.get(['mhLastResearch', 'mhDlStatus']).then(s => {
  if (s.mhLastResearch?.json) mhShowResearchResult(s.mhLastResearch);
  if (s.mhDlStatus?.kind === 'zoom-videos' && s.mhDlStatus.state !== 'complete') renderZoomVideoStatus(s.mhDlStatus);
}).catch(() => {});

// Build the text body Zoom recording lists use — kept identical to the
// legacy saveZoomFile output so users who turn extractTranscripts off
// still see the familiar format.
function buildZoomRecordingsText(data) {
  const lines = [];
  lines.push('Moodle Hoarder — Zoom Recordings');
  lines.push('================================');
  lines.push(`Source: ${data.pageUrl || '?'}`);
  lines.push(`Date:   ${new Date().toLocaleString('he-IL')}`);
  lines.push(`Found:  ${data.recordings.length} recordings`);
  lines.push('');
  lines.push('=========================================================');
  lines.push('');
  data.recordings.forEach((r, i) => {
    lines.push(`#${i + 1}. ${r.topic || '(no topic)'}`);
    if (r.meetingId) lines.push(`    Meeting ID: ${r.meetingId}`);
    if (r.date)      lines.push(`    Date:       ${r.date}`);
    const u = (r.shareUrls && r.shareUrls[0]) || r.detailUrl || '(no URL)';
    lines.push(`    URL:        ${u}`);
    lines.push('');
  });
  lines.push('=========================================================');
  lines.push('');
  const ok = data.recordings.filter(r => r.shareUrls?.length).length;
  lines.push(`נמצאו קישורים ל-${ok} מתוך ${data.recordings.length} הקלטות.`);
  return lines.join('\r\n');
}

// ========== Transcripts Phase 1 — real VTT extraction ==========
// Now that the debug capture confirmed the URL pattern is
//   /rec/play/vtt?type=transcript&fid=<token>&action=play
// served as XHR with body starting "WEBVTT", Phase 1 is straightforward:
// open each playback page in a hidden tab, install an XHR patch that
// watches specifically for that pattern, and snapshot the body.
//
// Returns: array of { recording, vtt?, vttUrl?, txt?, error? }.

async function extractZoomTranscripts(recordings, onProgress, concurrency) {
  const out = new Array(recordings.length);
  let nextIdx = 0;
  let doneCount = 0;
  const C = Math.max(1, Math.min(concurrency || 3, recordings.length));
  async function worker() {
    while (true) {
      const myIdx = nextIdx++;
      if (myIdx >= recordings.length) return;
      const rec = recordings[myIdx];
      try {
        out[myIdx] = await extractOneTranscript(rec);
      } catch (e) {
        out[myIdx] = { recording: rec, error: String(e) };
      }
      doneCount++;
      try { onProgress?.(doneCount, recordings.length, rec); } catch {}
    }
  }
  await Promise.all(Array.from({ length: C }, worker));
  return out;
}

// Extracts the VTT for a single recording. Workers in
// extractZoomTranscripts call this in parallel — each one owns its tab,
// so the global window.__mhVtt namespacing is fine (every tab has its
// own MAIN world).
async function extractOneTranscript(rec) {
  let tab = null;
  // Tunables. Initial settle = 4s gives the player time to mount.
  // earlyDeadlineMs = if no transcript UI present by then, the player
  // simply has no transcript → bail. hardDeadlineMs = absolute timeout
  // even if UI promises one but it never lands (broken processing).
  const INITIAL_SETTLE = 4000;
  const EARLY_BAIL_MS = 8000;
  const HARD_TIMEOUT_MS = 22000;
  try {
    tab = await chrome.tabs.create({ url: rec.url, active: false });
    await new Promise(r => setTimeout(r, INITIAL_SETTLE));
    // Install the watcher in MAIN world.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        if (window.__mhVttInstalled) return;
        window.__mhVttInstalled = true;
        window.__mhVtt = null;
        const isVtt = (u) => /\/rec\/play\/vtt\b[^?]*\??[^#]*type=transcript/i.test(u || '');
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
          this.__mhU = url;
          return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
          if (isVtt(this.__mhU)) {
            this.addEventListener('load', () => {
              try {
                if (this.status === 200) {
                  const body = this.responseText || '';
                  if (body.includes('WEBVTT')) {
                    window.__mhVtt = { url: this.__mhU, body };
                  }
                }
              } catch {}
            });
          }
          return origSend.apply(this, arguments);
        };
        const origFetch = window.fetch;
        window.fetch = async function (...args) {
          const url = (typeof args[0] === 'string') ? args[0] : (args[0]?.url || '');
          const res = await origFetch.apply(this, args);
          if (isVtt(url)) {
            try {
              const body = await res.clone().text();
              if (body.includes('WEBVTT')) {
                window.__mhVtt = { url, body };
              }
            } catch {}
          }
          return res;
        };
      },
    });
    // Poll: every 600ms, check for VTT body + DOM signal for transcript UI.
    // If no UI by the early-bail deadline, give up (saves ~15s per such
    // recording when the lecturer disabled transcripts).
    const start = Date.now();
    let payload = null;
    let earlyChecked = false;
    while (Date.now() - start < HARD_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, 600));
      let snap = null;
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => ({
            vtt: window.__mhVtt || null,
            // Multiple selectors because Zoom's React tree renames classes
            // between versions. Any of these existing means transcripts
            // are at least being prepared.
            uiHints: {
              transcriptClass: !!document.querySelector('[class*="transcript" i]'),
              transcriptDataAttr: !!document.querySelector('[data-test*="transcript" i], [data-testid*="transcript" i]'),
              ccButton: !!document.querySelector('button[aria-label*="transcript" i], button[aria-label*="caption" i], button[aria-label*="CC" i]'),
              captionsTrack: !!document.querySelector('track[kind="captions"], track[kind="subtitles"]'),
            },
          }),
        });
        snap = result;
      } catch {
        // Tab navigated or got removed; keep polling.
      }
      if (snap?.vtt?.body) { payload = snap.vtt; break; }
      if (!earlyChecked && Date.now() - start >= EARLY_BAIL_MS) {
        earlyChecked = true;
        const hints = snap?.uiHints || {};
        const anyHint = hints.transcriptClass || hints.transcriptDataAttr || hints.ccButton || hints.captionsTrack;
        if (!anyHint) {
          return {
            recording: rec,
            error: 'No transcript UI in DOM after 8s — recording likely has no transcript',
            skipReason: 'no-transcript-ui',
          };
        }
      }
    }
    if (payload) {
      return {
        recording: rec,
        vtt: payload.body,
        vttUrl: payload.url,
        txt: vttToCleanText(payload.body),
      };
    }
    return {
      recording: rec,
      error: `Timeout: ${HARD_TIMEOUT_MS / 1000}s without transcript (UI promised one but it never arrived)`,
      skipReason: 'timeout',
    };
  } finally {
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
  }
}

// Build a friendly filename stem for one recording. Uses the topic and
// a normalised date (YYYY-MM-DD_HH-MM) when parseable, falling back to
// a sanitised version of whatever Zoom gave us.
// ========== Recording video download ==========
// The signed ssrweb MP4 is fetched IN the zoom page and saved via a blob
// anchor by the background service worker (see background.js mh-download-rec).
// The old popup-side chrome.downloads path + quality chooser was removed
// in v1.32.2 — chrome.downloads.download mangled the signed URL (HTML 403).

function transcriptFileStem(rec) {
  const topic = sanitizeFilename(rec.topic || '') || 'recording';
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

// Pick a ZIP filename that reflects the content. If ≥70% of recordings
// share the same topic (common for a single-course extract), use that
// topic + " הקלטות" instead of the generic "zoom-recordings". Falls back
// to the legacy name when topics are too mixed.
function zoomHistoryTitle(recordings) {
  const topics = (recordings || []).map(r => (r.topic || '').trim()).filter(Boolean);
  if (!topics.length) return 'Zoom videos';
  const counts = new Map();
  for (const t of topics) counts.set(t, (counts.get(t) || 0) + 1);
  let dom = topics[0], max = 0;
  for (const [t, c] of counts) if (c > max) { dom = t; max = c; }
  return topics.length > 1 ? `${dom} — ${topics.length} הקלטות` : dom;
}

function zoomZipFilename(recordings, isoDate) {
  const topics = recordings.map(r => (r.topic || '').trim()).filter(Boolean);
  if (topics.length) {
    const counts = new Map();
    for (const t of topics) counts.set(t, (counts.get(t) || 0) + 1);
    let dom = null, max = 0;
    for (const [t, c] of counts) if (c > max) { max = c; dom = t; }
    if (dom && max / topics.length >= 0.7) {
      const cleanTopic = sanitizeFilename(dom) || 'zoom';
      return `${cleanTopic} הקלטות_${isoDate}.zip`;
    }
  }
  return `zoom-recordings_${isoDate}.zip`;
}

// Convert a raw WebVTT blob into readable timestamped text.
//   - Strips the WEBVTT header, NOTE blocks, X-TIMESTAMP-MAP, cue numbers.
//   - Replaces "HH:MM:SS.fff --> HH:MM:SS.fff" with a leading "[HH:MM:SS] ".
//   - One cue per line (no paragraph grouping by speaker — timestamps
//     already provide natural separation, and grouping was hiding when a
//     speaker said something brief then resumed).
//   - Keeps the "Speaker: text" label as it appears in the VTT.
// User request: "convert VTT to text including timestamps, no need for
// a separate VTT file in the ZIP, this is enough".
function vttToCleanText(vtt) {
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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === 'WEBVTT' || line.startsWith('WEBVTT')) continue;
    if (line.startsWith('NOTE') || line.startsWith('X-TIMESTAMP-MAP') || line.startsWith('STYLE')) continue;
    if (/^\d+$/.test(line)) continue;          // cue number
    // Timestamp line — "00:00:04.418 --> 00:00:18.504" (sometimes with
    // alignment / position metadata after). We start a new cue here.
    const tsMatch = line.match(/^(\d{1,2}:\d{2}:\d{2})[.,]\d+\s*-->\s*\d/);
    if (tsMatch) {
      flushCue();
      currentStart = tsMatch[1];
      continue;
    }
    // Some VTTs use M:SS without an hours component
    const tsMatch2 = line.match(/^(\d{1,2}:\d{2})[.,]\d+\s*-->\s*\d/);
    if (tsMatch2) {
      flushCue();
      currentStart = tsMatch2[1];
      continue;
    }
    if (!line) { flushCue(); continue; }
    buffer.push(line);
  }
  flushCue();
  return out.join('\n');
}

// ========== Transcripts Phase 0 (legacy debug capture) ==========
// Kept around in case we ever need to re-investigate a new Zoom tenant.
// Currently unused — the picker checkbox now feeds Phase 1.
async function captureZoomNetworkDebug(recordings, onProgress) {
  const results = [];
  for (let i = 0; i < recordings.length; i++) {
    const rec = recordings[i];
    onProgress?.(i, recordings.length, rec);
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url: rec.url, active: false });
      // Initial settle — Zoom playback pages are heavy SPAs.
      await new Promise(r => setTimeout(r, 3000));
      // Install a wide monkey-patch in MAIN world. Captures EVERY fetch
      // and XHR — we want the full picture of how the player loads its
      // media (MP4 direct vs HLS manifest+segments vs MSE).
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
          if (window.__mhMonInstalled) return;
          window.__mhMonInstalled = true;
          window.__mhRequests = [];
          // Wider net than before — also captures video/audio/mp4/m3u8/ts/octet-stream.
          const looksInteresting = (s) =>
            /vtt|transcript|caption|subtitle|cc\b|webvtt|json|xml|video|audio|mp4|m3u8|\.ts\b|mpegurl|octet-stream|file|play|stream|dl|range/i.test(s || '');
          const origFetch = window.fetch;
          window.fetch = async function (...args) {
            const url = (typeof args[0] === 'string') ? args[0] : (args[0]?.url || '');
            const method = (args[1] && args[1].method) || (args[0] && args[0].method) || 'GET';
            const reqHeaders = {};
            try {
              const h = args[1]?.headers;
              if (h && typeof h.forEach === 'function') h.forEach((v, k) => { reqHeaders[k] = v; });
              else if (h && typeof h === 'object') Object.assign(reqHeaders, h);
            } catch {}
            const startedAt = Date.now();
            try {
              const res = await origFetch.apply(this, args);
              const ct = res.headers.get('content-type') || '';
              const cl = +(res.headers.get('content-length') || 0) || null;
              const cr = res.headers.get('content-range') || null;
              const acceptRanges = res.headers.get('accept-ranges') || null;
              let snippet = null;
              // Only snippet small, text-y responses; never download a video into a snippet.
              if (looksInteresting(url) || /vtt|json|xml|text|mpegurl/i.test(ct)) {
                if (!/video|audio|octet-stream|mp4/i.test(ct) && cl !== null && cl < 200000) {
                  try { snippet = (await res.clone().text()).slice(0, 8000); } catch {}
                }
              }
              window.__mhRequests.push({
                via: 'fetch', method, url, reqHeaders,
                status: res.status, contentType: ct, contentLength: cl,
                contentRange: cr, acceptRanges,
                snippet, durationMs: Date.now() - startedAt,
              });
              return res;
            } catch (e) {
              window.__mhRequests.push({
                via: 'fetch', method, url, error: String(e),
                durationMs: Date.now() - startedAt,
              });
              throw e;
            }
          };
          const origOpen = XMLHttpRequest.prototype.open;
          const origSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function (method, url) {
            this.__mhM = method; this.__mhU = url; this.__mhReqHdrs = {};
            return origOpen.apply(this, arguments);
          };
          const origSetHdr = XMLHttpRequest.prototype.setRequestHeader;
          XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
            try { this.__mhReqHdrs[k.toLowerCase()] = v; } catch {}
            return origSetHdr.apply(this, arguments);
          };
          XMLHttpRequest.prototype.send = function () {
            const startedAt = Date.now();
            const url = this.__mhU || '';
            this.addEventListener('loadend', () => {
              const ct = (this.getResponseHeader && this.getResponseHeader('content-type')) || '';
              const cl = +(this.getResponseHeader && this.getResponseHeader('content-length')) || null;
              const cr = (this.getResponseHeader && this.getResponseHeader('content-range')) || null;
              const acceptRanges = (this.getResponseHeader && this.getResponseHeader('accept-ranges')) || null;
              let snippet = null;
              try {
                if ((looksInteresting(url) || /vtt|json|xml|text|mpegurl/i.test(ct))
                    && !/video|audio|octet-stream|mp4/i.test(ct)
                    && (this.responseType === '' || this.responseType === 'text')) {
                  snippet = (this.responseText || '').slice(0, 8000);
                }
              } catch {}
              window.__mhRequests.push({
                via: 'xhr', method: this.__mhM, url, reqHeaders: this.__mhReqHdrs,
                status: this.status, contentType: ct, contentLength: cl,
                contentRange: cr, acceptRanges,
                snippet, durationMs: Date.now() - startedAt,
              });
            });
            return origSend.apply(this, arguments);
          };
          // Capture MediaSource activity (HLS / DASH frequently use MSE).
          // We log every appendBuffer call's size + the source URL.
          window.__mhMseActivity = [];
          const origAddSourceBuffer = window.MediaSource?.prototype?.addSourceBuffer;
          if (origAddSourceBuffer) {
            window.MediaSource.prototype.addSourceBuffer = function (mime) {
              window.__mhMseActivity.push({ event: 'addSourceBuffer', mime, at: Date.now() });
              const sb = origAddSourceBuffer.apply(this, arguments);
              const origAppend = sb.appendBuffer;
              sb.appendBuffer = function (buf) {
                window.__mhMseActivity.push({
                  event: 'appendBuffer', mime,
                  byteLength: buf?.byteLength ?? null,
                  at: Date.now(),
                });
                return origAppend.apply(this, arguments);
              };
              return sb;
            };
          }
          // Track <video> elements' .src attribute changes — sometimes the
          // player just sets a blob URL or a direct MP4.
          const obs = new MutationObserver(() => {
            for (const v of document.querySelectorAll('video, audio')) {
              const src = v.currentSrc || v.src;
              if (src && !window.__mhMediaSrcs?.includes(src)) {
                (window.__mhMediaSrcs ||= []).push(src);
              }
            }
          });
          obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
        },
      });
      // Try to click "Play" so the player actually starts streaming the
      // video. Without this, we only see the initial bootstrap requests.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
          const candidates = [
            '.play-control',
            '.zm-control-button-play',
            'button.play-button',
            '[aria-label="Play" i]',
            '[aria-label="הפעל" i]',
            '[title="Play" i]',
            'button[data-tracking-id*="play" i]',
            '.center-play-btn',
            '.vjs-play-control',
            // Generic SVG play icon containers
            'div[role="button"][aria-label*="play" i]',
          ];
          for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el && !el.disabled) {
              try { el.click(); window.__mhPlayClicked = sel; return; } catch {}
            }
          }
          // Last resort: any visible button with text "Play"
          for (const b of document.querySelectorAll('button')) {
            const t = (b.textContent || '').trim().toLowerCase();
            if (t === 'play' || t === 'הפעל') {
              try { b.click(); window.__mhPlayClicked = `text:${t}`; return; } catch {}
            }
          }
        },
      });
      // Let the player actually stream for 20 seconds — long enough to
      // see MP4 byte-range chunks or several HLS segments fly by.
      await new Promise(r => setTimeout(r, 20000));
      // Snapshot.
      const [{ result: reqs }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => (window.__mhRequests || []),
      });
      const [{ result: extras }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => ({
          finalUrl: location.href,
          title: document.title,
          playClicked: window.__mhPlayClicked || null,
          mseActivity: window.__mhMseActivity || [],
          mediaElementSrcs: window.__mhMediaSrcs || [],
          // Snippet
          bodySnippet: (document.body?.innerText || '').slice(0, 2000),
          hasTranscriptPanel: !!document.querySelector(
            '[class*="transcript" i], [id*="transcript" i], [data-test*="transcript" i]'
          ),
          // Look for video tags in case MSE is in use
          videoCount: document.querySelectorAll('video').length,
          audioCount: document.querySelectorAll('audio').length,
        }),
      });
      // Classify the requests so the JSON is easier to read.
      const videoCandidates = [];
      const hlsManifests = [];
      const hlsSegments = [];
      const transcriptCandidates = [];
      const apiCalls = [];
      for (const r of reqs) {
        const u = r.url || '';
        const ct = r.contentType || '';
        if (/\.m3u8(\?|#|$)/i.test(u) || /mpegurl/i.test(ct)) {
          hlsManifests.push(r);
        } else if (/\.ts(\?|#|$)/i.test(u) || /video\/mp2t/i.test(ct)) {
          hlsSegments.push(r);
        } else if (/\.mp4|video\/mp4|octet-stream/i.test(u + ' ' + ct) && (r.contentLength ?? 0) > 1024 * 100) {
          videoCandidates.push(r);
        } else if (/vtt|webvtt|transcript|caption/i.test(u + ' ' + ct)) {
          transcriptCandidates.push(r);
        } else if (r.status === 200 && /json/i.test(ct)) {
          apiCalls.push({ url: r.url, contentType: ct, snippetPrefix: (r.snippet || '').slice(0, 200) });
        }
      }
      results.push({
        recording: { topic: rec.topic, date: rec.date, url: rec.url },
        finalPageUrl: extras.finalUrl,
        pageTitle: extras.title,
        playClicked: extras.playClicked,
        videoElementCount: extras.videoCount,
        audioElementCount: extras.audioCount,
        mediaElementSrcs: extras.mediaElementSrcs,
        mseActivity: extras.mseActivity,
        hasTranscriptPanel: extras.hasTranscriptPanel,
        bodySnippet: extras.bodySnippet,
        requestCount: reqs.length,
        // Pre-classified buckets — these are what I'll look at first.
        classification: {
          videoCandidates,
          hlsManifests,
          hlsSegments,
          transcriptCandidates,
          apiCallsSample: apiCalls.slice(0, 20),
        },
        allRequests: reqs,
      });
    } catch (e) {
      results.push({
        recording: { topic: rec.topic, date: rec.date, url: rec.url },
        error: String(e),
      });
    } finally {
      if (tab?.id) {
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
    }
  }
  return {
    schema: 'moodle-hoarder.zoom-debug.v2',
    generator: 'Moodle Hoarder',
    generatorVersion: chrome.runtime.getManifest?.()?.version || null,
    capturedAt: new Date().toISOString(),
    count: results.length,
    note: 'Phase 0 capture for RECORDING DOWNLOAD investigation. Look at classification.videoCandidates and classification.hlsManifests first — those answer "is this MP4 direct or HLS?". mseActivity tells whether MediaSource is in play (likely HLS/DASH). mediaElementSrcs catches blob URLs / direct MP4 URLs set on <video>. May contain JWT tokens — handle accordingly.',
    results,
  };
}

// ========== Download (single course) ==========
$('download').addEventListener('click', async () => {
  const selected = collectSelectedItems();
  if (!selected.length) return;
  $('download').disabled = true;
  $('back').disabled = true;

  await runDownload({
    courseName: scanned.courseName,
    courseId: scanned.courseId,
    courseUrl: scanned.courseUrl,
    items: selected,
  });

  $('back').disabled = false;
});

function collectSelectedItems() {
  const sel = [];
  scanned.sections.forEach(sec => sec.items.forEach(it => {
    const li = sectionsEl.querySelector(`li[data-idx="${it.idx}"]`);
    if (li && li.querySelector('input').checked) sel.push(it);
  }));
  return sel;
}

// ========== Download (multi-course) ==========
$('downloadMulti').addEventListener('click', async () => {
  const wanted = [...coursesEl.querySelectorAll('li')]
    .filter(li => li.querySelector('input').checked)
    .map(li => multiScanned.courses.find(c => c.id === li.dataset.id));
  if (!wanted.length) return;
  $('downloadMulti').disabled = true;
  $('backMulti').disabled = true;
  const onlyNew = $('onlyNewMulti').checked;

  logEl.innerHTML = '';
  for (let i = 0; i < wanted.length; i++) {
    const c = wanted[i];
    setStatus(`(${i + 1}/${wanted.length}) ${c.name}`);
    try {
      const data = await scanCourse(c.url);
      let items = [];
      data.sections.forEach((sec, sIdx) => sec.items.forEach(it => {
        if (onlyNew && isPreviouslySeen(data.prevSeen, it)) return;
        if (defaultChecked(it, sIdx)) items.push(it);
      }));
      if (!items.length) { logLine(t('log.nothing.to.download', { name: c.name }), 'ok'); continue; }
      await runDownload({
        courseName: data.courseName,
        courseId: data.courseId,
        courseUrl: c.url,
        items,
        silent: true,
      });
      logLine(t('log.course.items', { name: c.name, n: items.length }), 'ok');
    } catch (e) {
      logLine(`✗ ${c.name}: ${e.message}`, 'err');
    }
  }
  setStatus(t('status.completed'));
  setProgress(0, 0);
  notify('Moodle Hoarder', t('notif.multi.done', { n: wanted.length }));
  $('backMulti').disabled = false;
});

// Max items being downloaded concurrently. Tuned so Moodle doesn't rate-limit
// us — each fetchItem can itself fan out (folder/assign/page handlers fetch
// multiple files), so effective parallelism is higher.
const CONCURRENT_DOWNLOADS = 5;

// Fetch every item in parallel with a concurrency cap. Results array stays in
// original order so the ZIP and log don't reshuffle.
//
// If `checkpoint` is provided, completed items are persisted to chrome.storage
// after each finish — so a popup closing mid-download doesn't lose all progress.
// Completed items are SKIPPED on re-entry: the cached fetch result is restored
// into the results array and re-used.
async function fetchItemsParallel(items, concurrency, onProgress, checkpoint = null) {
  const results = new Array(items.length);
  const errors = [];
  let nextIdx = 0;
  let completed = 0;

  // Load prior progress so previously-fetched items don't have to be re-fetched.
  let cached = null;
  if (checkpoint) cached = await loadCheckpoint(checkpoint);

  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) return;
      const item = items[i];
      const cachedEntry = cached?.results?.[itemKey(item)];
      if (cachedEntry) {
        // Some entries are oversized markers (no blob cached) — re-fetch those
        // but skip the ones we have bytes for.
        const hasOversized = cachedEntry.some(r => r.oversized);
        if (!hasOversized) {
          try {
            results[i] = cachedEntry.map(r => {
              if (r.kind || !r.dataB64) return r;
              return { ...r, blob: blobFromBase64(r.dataB64, r.mime), dataB64: undefined };
            });
          } catch { results[i] = null; }
          completed++;
          onProgress?.(completed, items.length, item, true /* fromCache */);
          continue;
        }
        // Fall through to re-fetch when any sub-blob was too big to cache.
      }
      try {
        const got = await fetchItem(item);
        results[i] = got;
        if (checkpoint) await persistItemToCheckpoint(checkpoint, item, got);
      } catch (e) {
        errors.push({ item, err: e.message || String(e) });
        results[i] = null;
      } finally {
        completed++;
        onProgress?.(completed, items.length, item, false);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return { results, errors };
}

function itemKey(item) { return `${item.type}:${item.id}`; }

// Checkpoint storage. Keys: ckpt_<courseId>. Value: { startedAt, results: { 'type:id': [{kind?, path?, dataB64?, mime?}] } }
async function loadCheckpoint(courseId) {
  if (!courseId) return null;
  const key = `ckpt_${courseId}`;
  return (await chrome.storage.local.get(key))[key] || null;
}
// Skip checkpointing for files larger than this — base64 encoding triples
// memory pressure, and very large blobs can break chrome.storage.local even
// with the unlimitedStorage permission on some Chrome builds. The file will
// be re-fetched on resume rather than restored from cache.
const CHECKPOINT_MAX_BLOB_BYTES = 8 * 1024 * 1024;

async function persistItemToCheckpoint(courseId, item, fetchResults) {
  if (!courseId) return;
  const key = `ckpt_${courseId}`;
  try {
    const stored = (await chrome.storage.local.get(key))[key] || { startedAt: Date.now(), results: {} };
    const serial = await Promise.all((fetchResults || []).map(async r => {
      if (r.kind || !r.blob) return r;
      if (r.blob.size > CHECKPOINT_MAX_BLOB_BYTES) {
        // Mark this item as completed without caching the bytes; on resume we
        // will re-fetch. Still better than re-running fetchItem from scratch
        // because we record that the URL was reachable last time.
        return { path: r.path, oversized: true, mime: r.blob.type };
      }
      const dataB64 = await blobToBase64(r.blob);
      return { path: r.path, dataB64, mime: r.blob.type };
    }));
    stored.results[itemKey(item)] = serial;
    await chrome.storage.local.set({ [key]: stored });
  } catch (e) {
    // Storage quota / serialisation errors should never crash the download.
    console.warn('[Moodle Hoarder] checkpoint write failed:', e);
  }
}
async function clearCheckpoint(courseId) {
  if (!courseId) return;
  await chrome.storage.local.remove(`ckpt_${courseId}`);
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // chunk to avoid call-stack overflow on big files
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
function blobFromBase64(b64, mime = 'application/octet-stream') {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ========== Core download routine ==========
async function runDownload({ courseName, courseId, courseUrl, items, silent }) {
  if (!silent) logEl.innerHTML = '';
  setProgress(0, items.length);
  // Reset URL-activity debug bucket for this run. Anything fetchUrlActivity
  // can't resolve to a file gets pushed here and ends up in _url-debug.json.
  URL_DEBUG_TRACES = [];

  const files = [];
  const links = [];      // generic URL activities
  const recordings = []; // streaming
  const events = [];     // calendar deadlines
  const used = new Set();

  // Phase 1: parallel fetch with checkpoint resume on courseId.
  setStatus(t('status.downloading.parallel', { n: items.length, c: CONCURRENT_DOWNLOADS }));
  const { results, errors } = await fetchItemsParallel(items, CONCURRENT_DOWNLOADS,
    (done, total, item, fromCache) => {
      const prefix = fromCache ? '↻' : '✓';
      setStatus(`(${done}/${total}) ${prefix} ${item.name}`);
      setProgress(done, total);
    },
    courseId);

  if (!silent) {
    for (const { item, err } of errors) logLine(`✗ ${item.name}: ${err}`, 'err');
  }

  // Phase 2: assemble paths in original order (so the ZIP and log are stable)
  const layout = CACHED_SETTINGS?.zipLayout || 'both';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const got = results[i];
    if (!got) continue;
    for (const r of got) {
      if (r.kind === 'recording') recordings.push(r);
      else if (r.kind === 'link') links.push(r);
      else if (r.kind === 'event') events.push(r.event);
      else {
        // Each downloaded file can go into two places in the ZIP, controlled by settings.zipLayout:
        //   'sections' = only the numbered section folder
        //   'flat'     = only the single "00 - כל הקבצים" folder
        //   'both'     = both views (default; ZIP about 2x larger)
        if (layout === 'sections' || layout === 'both') {
          const sectionIdx = item.sectionIdx ?? 0;
          const sectionNum = String(sectionIdx + 1).padStart(2, '0');
          const sectionName = sanitizeFilename(item.section || 'כללי') || 'כללי';
          const sectionPath = uniquePath(used, `${sectionNum} - ${sectionName}/${r.path}`);
          files.push({ path: sectionPath, blob: r.blob });
          if (!silent) logLine(`✓ ${sectionPath} (${formatSize(r.blob.size)})`, 'ok');
        }
        if (layout === 'flat' || layout === 'both') {
          const filename = r.path.split('/').pop();
          const isSubmission = r.path.includes('/_הגשות שלי/');
          const flatRel = isSubmission ? `_הגשות שלי/${filename}` : filename;
          const flatPath = uniquePath(used, `00 - כל הקבצים/${flatRel}`);
          files.push({ path: flatPath, blob: r.blob });
          if (!silent && layout === 'flat') logLine(`✓ ${flatPath} (${formatSize(r.blob.size)})`, 'ok');
        }
      }
    }
  }

  // Companion files inside the ZIP
  if (links.length) {
    files.push({ path: 'links.txt', blob: textBlob(formatLinkList(links, 'קישורים')) });
  }
  if (recordings.length) {
    files.push({ path: 'recordings.txt', blob: textBlob(formatLinkList(recordings, 'הקלטות וסרטונים')) });
  }
  if (events.length) {
    files.push({ path: 'deadlines.ics', blob: textBlob(buildICS(events, courseName), 'text/calendar;charset=utf-8') });
  }

  // Optional: grades export
  if (courseId && CACHED_SETTINGS?.includeGrades) {
    try {
      const csv = await fetchGradesCsv(courseId);
      if (csv) files.push({ path: 'ציונים.csv', blob: textBlob(csv, 'text/csv;charset=utf-8') });
    } catch (e) {
      if (!silent) logLine(t('log.grades.failed', { msg: e.message }), 'err');
    }
  }
  const info = buildInfo({ courseName, courseUrl, items, files, links, recordings, events, errors });
  files.push({ path: 'info.txt', blob: textBlob(info) });

  // URL-activity debug sidecar. Only included when at least one URL item
  // failed to resolve to a downloadable file. Lets the user (and future
  // me) inspect exactly what the page returned and which selectors didn't
  // match. Captures HTML snippets capped at 80KB per stage.
  if (URL_DEBUG_TRACES.length > 0) {
    const debugPayload = {
      schema: 'moodle-hoarder.url-debug.v1',
      generator: 'Moodle Hoarder',
      generatorVersion: chrome.runtime.getManifest?.()?.version || null,
      courseName,
      courseId: courseId || null,
      courseUrl,
      capturedAt: new Date().toISOString(),
      failedUrlCount: URL_DEBUG_TRACES.length,
      note: 'URL activities that ended as links rather than files. Inspect each entry`s stages to see what the page returned. May contain HTML with personal info — review before sharing.',
      traces: URL_DEBUG_TRACES,
    };
    files.push({
      path: '_url-debug.json',
      blob: new Blob([JSON.stringify(debugPayload, null, 2)], { type: 'application/json' }),
    });
  }

  // Structured machine-readable dump of the course (ROADMAP #72).
  // Doesn't include the file blobs themselves — just metadata — so it's
  // safe to share separately and small enough to add to every ZIP.
  if (CACHED_SETTINGS?.includeJson !== false) {
    const courseJson = buildCourseJson({
      courseName, courseId, courseUrl, items,
      sections: scanned?.sections || null,
      links, recordings, events, errors,
    });
    // No BOM here — strict JSON parsers reject it.
    files.push({ path: 'course.json', blob: new Blob([courseJson], { type: 'application/json;charset=utf-8' }) });
  }

  setStatus(t('status.zipping.bundle'));
  setProgress(items.length, items.length);

  const zipBlob = await buildZip(files);
  const blobUrl = URL.createObjectURL(zipBlob);
  const baseName = sanitizeFilename(courseName) + '.zip';
  const subfolder = (CACHED_SETTINGS?.downloadSubfolder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const filename = subfolder ? `${subfolder}/${baseName}` : baseName;
  await chrome.downloads.download({ url: blobUrl, filename, saveAs: !!CACHED_SETTINGS?.saveAs });

  // Persist "seen" snapshot (include courseName for the history dashboard).
  if (courseId) {
    await saveSeen(courseId, items, { courseName, courseUrl });
    // Successful run — clear the checkpoint so the next download starts fresh.
    await clearCheckpoint(courseId);
    // Bump download counter so frequent courses auto-pin in multi-course view.
    await bumpCourseClick(courseId);
  }
  await appendDownloadHistory({
    type: 'course', title: courseName, courseId, sourceUrl: courseUrl, startedAt: Date.now(), finishedAt: Date.now(),
    status: errors.length ? 'partial' : 'success', itemCount: items.length, successCount: files.length, failedCount: errors.length,
    bytes: zipBlob.size, filename,
  });

  setStatus(t('status.completed.with.count', { n: files.length, size: formatSize(zipBlob.size) }));
  if (!silent) notify('Moodle Hoarder', t('notif.course.done', { n: files.length, name: courseName }));
}

function buildInfo({ courseName, courseUrl, items, files, links, recordings, events, errors }) {
  const lines = [];
  lines.push('Moodle Hoarder');
  lines.push('===============');
  lines.push(`קורס: ${courseName}`);
  lines.push(`כתובת: ${courseUrl}`);
  lines.push(`תאריך הורדה: ${new Date().toLocaleString('he-IL')}`);
  lines.push(`קבצים: ${files.length}`);
  lines.push(`קישורים: ${links.length}`);
  lines.push(`הקלטות: ${recordings.length}`);
  lines.push(`דדליינים ביומן: ${events.length}`);
  lines.push(`שגיאות: ${errors.length}`);
  lines.push('');
  if (errors.length) {
    lines.push('-- שגיאות --');
    for (const { item, err } of errors) lines.push(`✗ [${item.type}] ${item.name} — ${err}`);
    lines.push('');
  }
  lines.push('-- פריטים שנבחרו --');
  for (const it of items) lines.push(`[${it.type}] ${it.name}`);
  return lines.join('\r\n');
}

function formatLinkList(arr, title) {
  const lines = [title, '='.repeat(title.length), ''];
  for (const l of arr) lines.push(`[${l.type || 'url'}] ${l.name}\n${l.url}\n`);
  return lines.join('\r\n');
}

// Machine-readable course dump (ROADMAP #72). Intentionally NOT bundling
// the file blobs — this is a metadata sidecar. Schema is versioned so
// downstream tools can detect breaks.
function buildCourseJson({ courseName, courseId, courseUrl, items, sections, links, recordings, events, errors }) {
  // Group items by sectionIdx for the nested structure, but also expose
  // a flat `items` array (callers can use whichever is easier).
  const sectionMap = new Map();
  for (const it of items) {
    const sIdx = it.sectionIdx ?? 0;
    if (!sectionMap.has(sIdx)) sectionMap.set(sIdx, []);
    sectionMap.get(sIdx).push({
      id: it.id,
      type: it.type,
      name: it.name,
      url: it.url,
      sectionIdx: sIdx,
      sectionName: it.section || null,
      // Populated by the HEAD pre-scan (ROADMAP #19), may be null when
      // size couldn't be determined or the user disabled the scan.
      sizeBytes: (typeof it.estimatedSize === 'number') ? it.estimatedSize : null,
    });
  }
  const sectionsOut = [];
  // Preserve scan order — use the scanned `sections` array if available,
  // otherwise fall back to sectionMap iteration order.
  if (Array.isArray(sections)) {
    sections.forEach((sec, sIdx) => {
      const its = sectionMap.get(sIdx) || [];
      sectionsOut.push({ index: sIdx, name: sec.name, itemCount: its.length, items: its });
    });
  } else {
    for (const [sIdx, its] of sectionMap.entries()) {
      sectionsOut.push({ index: sIdx, name: its[0]?.sectionName || null, itemCount: its.length, items: its });
    }
  }
  return JSON.stringify({
    schema: 'moodle-hoarder.course.v1',
    generator: 'Moodle Hoarder',
    generatorVersion: chrome.runtime.getManifest?.()?.version || null,
    scannedAt: new Date().toISOString(),
    course: {
      id: courseId || null,
      name: courseName,
      url: courseUrl,
    },
    counts: {
      sections: sectionsOut.length,
      items: items.length,
      links: links.length,
      recordings: recordings.length,
      events: events.length,
      errors: errors?.length || 0,
    },
    sections: sectionsOut,
    links: links.map(l => ({ name: l.name, type: l.type || 'url', url: l.url })),
    recordings: recordings.map(r => ({ name: r.name, type: r.type || 'recording', url: r.url })),
    events: events.map(e => ({
      title: e.summary || null,
      start: e.start instanceof Date ? e.start.toISOString() : e.start || null,
      url: e.url || null,
    })),
    errors: (errors || []).map(({ item, err }) => ({
      type: item?.type,
      id: item?.id,
      name: item?.name,
      message: err,
    })),
  }, null, 2);
}

function textBlob(s, type = 'text/plain;charset=utf-8') {
  return new Blob(['﻿' + s], { type }); // BOM for Windows Notepad readability
}

function resetFooter() {
  setStatus('');
  setProgress(0, 0);
  logEl.classList.remove('show');
  logEl.innerHTML = '';
}

function notify(title, message) {
  try {
    chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon-128.png', title, message });
  } catch {}
}

async function appendDownloadHistory(entry) {
  try {
    const stored = await chrome.storage.local.get(DOWNLOAD_HISTORY_KEY);
    const history = Array.isArray(stored[DOWNLOAD_HISTORY_KEY]) ? stored[DOWNLOAD_HISTORY_KEY] : [];
    history.unshift({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, ...entry });
    await chrome.storage.local.set({ [DOWNLOAD_HISTORY_KEY]: history.slice(0, 200) });
  } catch {}
}

// ========== Storage (diff mode) ==========
async function loadSeen(courseId) {
  if (!courseId) return null;
  const key = `seen_${courseId}`;
  const obj = await chrome.storage.local.get(key);
  return obj[key] || null;
}
async function saveSeen(courseId, items, meta = {}) {
  const key = `seen_${courseId}`;
  const prev = (await chrome.storage.local.get(key))[key] || {};
  await chrome.storage.local.set({
    [key]: {
      ...prev,
      lastDownload: Date.now(),
      // Track size+url so diff mode can detect "updated" files (same item, different size).
      items: items.map(i => ({
        type: i.type, id: i.id, name: i.name,
        size: i._lastSize ?? prev.items?.find(p => p.type === i.type && p.id === i.id)?.size,
      })),
      courseName: meta.courseName || prev.courseName,
      courseUrl: meta.courseUrl || prev.courseUrl,
    },
  });
}
function formatDateShort(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('he-IL');
}

// ========== Fetchers ==========
function isStreamingUrl(u) {
  try { return STREAM_HOSTS.some(h => new URL(u).hostname.toLowerCase().includes(h)); }
  catch { return false; }
}

async function fetchItem(item) {
  switch (item.type) {
    case 'resource': return await fetchResource(item);
    case 'folder':   return await fetchFolder(item);
    case 'assign':   return await fetchAssign(item);
    case 'url':      return await fetchUrlActivity(item);
    case 'page':     return await fetchPage(item);
    case 'book':     return await fetchBook(item);
    default:
      return [{ kind: 'link', type: item.type, name: item.name, url: item.url }];
  }
}

async function fetchResource(item) {
  const url = item.url + (item.url.includes('?') ? '&' : '?') + 'redirect=1';
  let res = await fetch(url, { credentials: 'include' });
  const ct = (res.headers.get('Content-Type') || '').toLowerCase();
  if (ct.includes('text/html')) {
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const link = doc.querySelector('a[href*="pluginfile.php"], object[data*="pluginfile.php"], iframe[src*="pluginfile.php"]');
    const fileUrl = link?.href || link?.getAttribute?.('data') || link?.src;
    if (!fileUrl) throw new Error(t('err.file.not.found'));
    res = await fetch(fileUrl, { credentials: 'include' });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Note: the old hard-throw on Content-Length > maxFileSizeMB lived here.
  // It now happens at picker time (HEAD pre-scan, ROADMAP #19) — the user
  // sees an oversized red chip and the item is auto-unchecked. If they
  // override and re-check it, they explicitly opted in, so we don't
  // second-guess them with another size check mid-download.
  const blob = await res.blob();
  const fn = filenameFromResponse(res) || sanitizeFilename(item.name) || `resource_${item.id}`;
  return [{ path: await maybePdfRename(fn, blob), blob }];
}

async function fetchFolder(item) {
  const u = new URL(item.url);
  const dlUrl = `${u.origin}/mod/folder/download_folder.php?id=${item.id}`;
  try {
    const res = await fetch(dlUrl, { credentials: 'include' });
    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    if (res.ok && (ct.includes('zip') || ct.includes('octet-stream'))) {
      // Size check happens at picker time now (ROADMAP #19). If the user
      // re-checked an oversized folder, they explicitly opted in.
      const blob = await res.blob();
      const fn = filenameFromResponse(res) || (sanitizeFilename(item.name) + '.zip');
      return [{ path: fn, blob }];
    }
  } catch {}
  // Fallback: scrape
  const res = await fetch(item.url, { credentials: 'include' });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const folder = sanitizeFilename(item.name) || `folder_${item.id}`;
  for (const a of doc.querySelectorAll('a[href*="pluginfile.php"]')) {
    try {
      const r = await fetch(a.href, { credentials: 'include' });
      if (!r.ok) continue;
      const blob = await r.blob();
      const fn = filenameFromResponse(r) || decodeURIComponent(a.href.split('/').pop()) || 'file';
      out.push({ path: `${folder}/${await maybePdfRename(fn, blob)}`, blob });
    } catch {}
  }
  if (!out.length) throw new Error(t('err.folder.empty'));
  return out;
}

async function fetchAssign(item) {
  const res = await fetch(item.url, { credentials: 'include' });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const folder = sanitizeFilename(item.name) || `assign_${item.id}`;

  // Assignment materials (introattachments)
  const introLinks = new Set();
  for (const a of doc.querySelectorAll('a[href*="pluginfile.php"]')) {
    if (a.href.includes('/introattachment/') || a.href.includes('/mod_assign/intro')) introLinks.add(a.href);
  }
  for (const url of introLinks) {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) continue;
      const blob = await r.blob();
      const fn = filenameFromResponse(r) || decodeURIComponent(url.split('/').pop()) || 'file';
      out.push({ path: `${folder}/${await maybePdfRename(fn, blob)}`, blob });
    } catch {}
  }

  // Your submissions
  const subLinks = new Set();
  for (const a of doc.querySelectorAll('a[href*="pluginfile.php"]')) {
    if (a.href.includes('/assignsubmission_file/') || a.href.includes('/submission_files/')) subLinks.add(a.href);
  }
  for (const url of subLinks) {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) continue;
      const blob = await r.blob();
      const fn = filenameFromResponse(r) || decodeURIComponent(url.split('/').pop()) || 'file';
      out.push({ path: `${folder}/_הגשות שלי/${await maybePdfRename(fn, blob)}`, blob });
    } catch {}
  }

  // Due date → ICS event
  const due = extractAssignDue(doc);
  if (due) {
    out.push({ kind: 'event', event: {
      uid: `assign-${item.id}@moodle-hoarder`,
      summary: item.name,
      start: due,
      url: item.url,
      description: `מטלה במודל: ${item.name}`,
    }});
  }

  return out;
}

function extractAssignDue(doc) {
  // Approach 1: structured timestamps (most reliable)
  for (const el of doc.querySelectorAll('[data-timestamp]')) {
    const v = +el.dataset.timestamp;
    if (!isNaN(v) && v > 0) {
      // The activity-dates block usually has multiple timestamps (open + due).
      // Prefer one labeled as "due"/"close"/"מועד אחרון".
      const labelEl = el.closest('[data-region="activity-date"], .activity-date, div, li');
      const label = (labelEl?.textContent || '').toLowerCase();
      if (/מועד\s+אחרון|תאריך\s+אחרון|due|close|cut[-\s]?off|deadline|הגשה/i.test(label)) {
        return new Date(v < 1e12 ? v * 1000 : v);
      }
    }
  }
  for (const el of doc.querySelectorAll('time[datetime]')) {
    const t = new Date(el.dateTime);
    if (!isNaN(t)) {
      const ctx = (el.closest('[data-region="activity-date"], .activity-date, div, li, td, tr')?.textContent || '').toLowerCase();
      if (/מועד\s+אחרון|תאריך\s+אחרון|due|close|cut[-\s]?off|deadline|הגשה/i.test(ctx)) {
        return t;
      }
    }
  }

  // Approach 2: text scrape — look for cells/divs whose text mentions a due-like label
  const candidates = [];
  for (const el of doc.querySelectorAll('.activity-dates div, .activity-dates [data-region="activity-date"], table tr td, .description-inner div, .description-content div, .description div, dl > *')) {
    const t = (el.textContent || '').trim();
    if (!t) continue;
    if (/תאריך\s+אחרון|מועד\s+אחרון|תאריך\s+הגשה|מועד\s+הגשה|due\s+date|cut[-\s]?off|deadline|close/i.test(t)) {
      candidates.push(t);
    }
  }
  // Sibling cell pattern (table-based assignment summary)
  for (const td of doc.querySelectorAll('td, dt')) {
    if (/תאריך\s+אחרון|מועד\s+אחרון|תאריך\s+הגשה|מועד\s+הגשה|due\s+date|cut[-\s]?off/i.test(td.textContent || '')) {
      const next = td.nextElementSibling;
      if (next) candidates.push(next.textContent.trim());
    }
  }
  for (const c of candidates) {
    const d = parseDate(c);
    if (d) return d;
  }
  // Approach 3: any standalone time element in the activity-dates block
  const dueTimeEl = doc.querySelector('[data-region="activity-dates"] time[datetime], .activity-dates time[datetime]');
  if (dueTimeEl?.dateTime) {
    const t = new Date(dueTimeEl.dateTime);
    if (!isNaN(t)) return t;
  }
  return null;
}

// Per-download bucket for URL-activity debug traces. Reset by runDownload
// at the start of each course. Captures the full chain for every URL
// item that ended up as a "link" (i.e. we couldn't grab the file). The
// info gets serialised into _url-debug.json inside the ZIP if there are
// any failures, so the user can inspect / share it.
let URL_DEBUG_TRACES = [];

function _headersToObj(h) {
  const o = {};
  try { h.forEach((v, k) => { o[k] = v; }); } catch {}
  return o;
}
function _capHtml(s, limit = 80000) {
  if (!s) return s;
  return s.length > limit ? s.slice(0, limit) + `\n... [truncated, total ${s.length} chars]` : s;
}

async function fetchUrlActivity(item) {
  // Step 1: hit mod/url/view.php with redirect=1 so Moodle follows its own
  // workaround and either delivers the file content directly or 302s us to
  // the external URL. We follow all redirects automatically.
  const moodleUrl = item.url + (item.url.includes('?') ? '&' : '?') + 'redirect=1';
  const trace = {
    item: { id: item.id, name: item.name, url: item.url, sectionIdx: item.sectionIdx },
    stages: [],
    finalResult: null,
  };
  let res, finalUrl, ct, cd;
  try {
    res = await fetch(moodleUrl, { credentials: 'include', redirect: 'follow' });
    finalUrl = res.url || item.url;
    ct = (res.headers.get('Content-Type') || '').toLowerCase();
    cd = (res.headers.get('Content-Disposition') || '').toLowerCase();
    trace.stages.push({
      stage: 'moodle-url',
      requested: moodleUrl,
      finalUrl,
      status: res.status,
      contentType: ct,
      contentDisposition: cd,
      headers: _headersToObj(res.headers),
    });
  } catch (e) {
    trace.stages.push({ stage: 'moodle-url', requested: moodleUrl, error: String(e) });
    trace.finalResult = 'link-on-fetch-error';
    URL_DEBUG_TRACES.push(trace);
    return [{ kind: 'link', type: 'url', name: item.name, url: item.url }];
  }

  // Fast path #1: response is already a file (PDF/Office/binary)
  if (isFileResponse(ct, cd, finalUrl)) {
    try {
      const blob = await res.blob();
      const fn = filenameFromResponse(res)
              || (sanitizeFilename(item.name) + (extFromCT(ct) || extFromUrl(finalUrl) || ''));
      return [{ path: fn, blob }];
    } catch {}
  }

  // Otherwise it's HTML — could be Moodle's "click here" workaround or the
  // actual external page.
  let html = '';
  try { html = await res.text(); } catch {}
  trace.stages[0].htmlSnippet = _capHtml(html);
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Step 2: extract the external URL
  let external = doc.querySelector('a.urlworkaround')?.href
              || doc.querySelector('.urlworkaround a')?.href
              || doc.querySelector('main a[href^="http"]:not([href*="moodlearn"])')?.href;
  let externalSource = external ? 'dom-anchor' : null;
  if (!external) {
    const m = html.match(/url\s*=\s*['"](https?:[^'"]+)['"]/i)
           || html.match(/window\.location(?:\.href)?\s*=\s*['"](https?:[^'"]+)['"]/i)
           || html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"';]+)/i);
    if (m) { external = m[1].trim(); externalSource = 'regex'; }
  }
  // If we got redirected to a non-Moodle URL but never found an external link,
  // use the final URL as the external.
  if (!external && finalUrl && !finalUrl.includes('moodlearn')) {
    external = finalUrl;
    externalSource = 'redirected-final-url';
  }
  trace.externalSource = externalSource;
  trace.externalUrl = external;
  if (!external) {
    trace.finalResult = 'link-no-external';
    URL_DEBUG_TRACES.push(trace);
    return [{ kind: 'link', type: 'url', name: item.name, url: item.url }];
  }

  // Step 3: classify
  if (isStreamingUrl(external)) {
    return [{ kind: 'recording', type: 'recording', name: item.name, url: external }];
  }
  if (!isAllowedHost(external)) {
    trace.finalResult = 'link-host-not-allowed';
    URL_DEBUG_TRACES.push(trace);
    return [{ kind: 'link', type: 'url', name: item.name, url: external }];
  }

  // Step 3.5 — SPA detour for meyda's syllabus viewer.
  // PAUSED IN v1.22.2: meyda's server has been inconsistent — the
  // Angular SPA sometimes renders content and a "הדפס" button, other
  // times it doesn't render anything at all (bodyTextLen<20, zero API
  // calls, zero buttons). User confirmed even manual access to meyda
  // currently fails to deliver the syllabus. Running the detour
  // unconditionally just burns ~11 seconds per syllabus for no gain.
  // Gated behind the `tryMeydaSyllabusDetour` setting (default false)
  // so the code is preserved and a curious user can re-enable when
  // meyda comes back online.
  if (CACHED_SETTINGS?.tryMeydaSyllabusDetour && isMeydaSyllabus(external)) {
    trace.stages.push({ stage: 'meyda-spa-detour', requested: external });
    try {
      const result = await fetchMeydaSyllabus(item, external, trace);
      if (result) {
        trace.finalResult = 'meyda-resolved';
        URL_DEBUG_TRACES.push(trace);
        return result;
      }
    } catch (e) {
      trace.stages[trace.stages.length - 1].error = String(e);
    }
    // Fall through to the standard flow — at worst we'll still end up
    // as a link, but we tried.
  }

  // Step 4: fetch the external URL. Be aggressive — if it's a file, save it;
  // if it's an HTML page that contains a direct download link to a PDF/Office
  // file, follow that one level deeper.
  let externalHtml = null;
  try {
    const r = await fetch(external, { credentials: 'include', redirect: 'follow' });
    const rct = (r.headers.get('Content-Type') || '').toLowerCase();
    const rcd = (r.headers.get('Content-Disposition') || '').toLowerCase();
    const rFinalUrl = r.url || external;
    trace.stages.push({
      stage: 'external',
      requested: external,
      finalUrl: rFinalUrl,
      status: r.status,
      contentType: rct,
      contentDisposition: rcd,
      headers: _headersToObj(r.headers),
    });
    if (r.ok) {
      if (isFileResponse(rct, rcd, rFinalUrl)) {
        const blob = await r.blob();
        const fn = filenameFromResponse(r)
                || (sanitizeFilename(item.name) + (extFromCT(rct) || extFromUrl(rFinalUrl) || ''));
        return [{ path: fn, blob }];
      }

      // External page is HTML — look for an obvious "download this" link.
      externalHtml = await r.text();
      trace.stages[trace.stages.length - 1].htmlSnippet = _capHtml(externalHtml);
      const externalDoc = new DOMParser().parseFromString(externalHtml, 'text/html');
      // Enumerate all anchor candidates for the debug trace, so we can
      // see what the meyda (or whatever) page actually exposes.
      const allCandidates = [...externalDoc.querySelectorAll('a[href], button[onclick], button[data-href], [data-download], iframe[src], embed[src], object[data]')].slice(0, 50).map(el => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 120),
        href: el.getAttribute('href') || el.getAttribute('data-href') || el.getAttribute('onclick') || el.getAttribute('src') || el.getAttribute('data') || null,
        download: el.getAttribute('download') || null,
        classes: el.className || null,
      }));
      trace.stages[trace.stages.length - 1].candidates = allCandidates;
      const downloadCand = externalDoc.querySelector(
        'a[download], a[href*=".pdf" i], a[href*=".docx" i], a[href*=".pptx" i],'
        + ' a[href*="forcedownload" i], a[href*="getfile" i], a[href*="syllabus" i],'
        + ' a[href*="download" i], a[href*="print" i], a[href*="export" i]'
      );
      if (downloadCand) {
        const downloadUrl = new URL(downloadCand.getAttribute('href'), rFinalUrl).href;
        trace.downloadCandidate = { url: downloadUrl, text: downloadCand.textContent.trim().slice(0, 100) };
        if (isAllowedHost(downloadUrl)) {
          try {
            const dr = await fetch(downloadUrl, { credentials: 'include', redirect: 'follow' });
            const dct = (dr.headers.get('Content-Type') || '').toLowerCase();
            const dcd = (dr.headers.get('Content-Disposition') || '').toLowerCase();
            trace.stages.push({
              stage: 'download-candidate',
              requested: downloadUrl,
              finalUrl: dr.url,
              status: dr.status,
              contentType: dct,
              contentDisposition: dcd,
              headers: _headersToObj(dr.headers),
            });
            if (dr.ok && isFileResponse(dct, dcd, dr.url || downloadUrl)) {
              const blob = await dr.blob();
              const fn = filenameFromResponse(dr)
                      || (sanitizeFilename(item.name) + (extFromCT(dct) || extFromUrl(downloadUrl) || ''));
              return [{ path: fn, blob }];
            }
            // Capture the body for debug if we still don't have a file.
            try {
              const dt = await dr.text();
              trace.stages[trace.stages.length - 1].htmlSnippet = _capHtml(dt, 40000);
            } catch {}
          } catch (e) {
            trace.stages.push({ stage: 'download-candidate', requested: downloadUrl, error: String(e) });
          }
        } else {
          trace.downloadCandidate.skippedBecause = 'host-not-allowed';
        }
      } else {
        trace.downloadCandidate = null;
      }
    }
  } catch (e) {
    trace.stages.push({ stage: 'external', requested: external, error: String(e) });
  }

  trace.finalResult = 'link-no-download-found';
  URL_DEBUG_TRACES.push(trace);
  return [{ kind: 'link', type: 'url', name: item.name, url: external }];
}

// Detects whether a URL points to Ariel's meyda syllabus viewer — an
// Angular SPA at meyda.ariel.ac.il/Portals/*/show-syllabus/<id> whose
// static HTML is empty (1.4KB shell). Only the rendered DOM has the
// actual PDF link, so we have to load it in a real tab.
function isMeydaSyllabus(url) {
  try {
    const u = new URL(url);
    return /(^|\.)meyda\.ariel\.ac\.il$/i.test(u.hostname)
        && /\/portals\/[^/]+\/show-syllabus\/\d+/i.test(u.pathname);
  } catch { return false; }
}

// Opens the meyda URL in a hidden background tab, installs fetch + XHR
// monkey-patches in MAIN world so we can see what the Angular app
// requests, waits ~8 seconds for the SPA to fully render and load the
// syllabus, then collects candidate PDF URLs from both the rendered DOM
// (iframe / embed / object / anchors) and the captured network log.
// Tries fetching each candidate with credentials; first one that comes
// back as a real file wins.
//
// Returns an array of { path, blob } on success, or null if we couldn't
// resolve a PDF. The caller still records the trace for the debug JSON.
// Helper: is this URL obviously NOT the PDF we want? Cross-origin junk
// like reCAPTCHA, Google fonts, analytics, etc. CORS will reject fetches
// to these anyway, and we don't want to waste time trying.
function _isMeydaCandidateJunk(u) {
  if (!u) return true;
  if (!/^https?:/i.test(u)) return true;
  return /google\.com\/(recaptcha|fonts|analytics|maps)|googletagmanager|fonts\.googleapis|gstatic|googleusercontent|youtube|facebook|twitter|hotjar|clarity|segment|hubspot/i.test(u);
}

async function fetchMeydaSyllabus(item, finalUrl, trace) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: finalUrl, active: false });
    await new Promise(r => setTimeout(r, 1500));
    // Install a wide-net monitor: fetch + XHR + window.open + window.print.
    // We log EVERY outgoing URL so post-processing can filter — the
    // earlier "only file-like" filter missed cases where the response
    // isn't a file directly but the URL leads to one after click.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        if (window.__mhMeydaInstalled) return;
        window.__mhMeydaInstalled = true;
        window.__mhMeydaAll = [];     // every outgoing url
        window.__mhMeydaPrint = false;
        const remember = (kind, url, ct, size) => {
          if (!url) return;
          window.__mhMeydaAll.push({ kind, url, contentType: ct || null, size: size || null, at: Date.now() });
        };
        const origFetch = window.fetch;
        window.fetch = async function (...args) {
          const url = (typeof args[0] === 'string') ? args[0] : (args[0]?.url || '');
          try {
            const res = await origFetch.apply(this, args);
            const ct = res.headers.get('content-type') || '';
            const cl = +(res.headers.get('content-length') || 0) || null;
            remember('fetch', url, ct, cl);
            return res;
          } catch (e) {
            remember('fetch-error', url, null, null);
            throw e;
          }
        };
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
          this.__mhU = url;
          return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
          this.addEventListener('load', () => {
            try {
              const ct = (this.getResponseHeader && this.getResponseHeader('content-type')) || '';
              const cl = +(this.getResponseHeader && this.getResponseHeader('content-length')) || null;
              remember('xhr', this.__mhU, ct, cl);
            } catch {}
          });
          return origSend.apply(this, arguments);
        };
        // window.open often delivers the PDF in a new tab — capture the URL.
        const origWindowOpen = window.open;
        window.open = function (url, ...rest) {
          if (url) remember('window.open', String(url), null, null);
          return origWindowOpen.apply(this, [url, ...rest]);
        };
        // Some apps use window.print() instead of fetching. Flag it so
        // the caller knows we'd need a different strategy.
        const origPrint = window.print;
        window.print = function () {
          window.__mhMeydaPrint = true;
          return origPrint.apply(this, arguments);
        };
      },
    });
    // Phase A — let Angular boot. ~5s is enough for the SPA to render
    // and run any initial API calls. If a PDF auto-loads (rare), we
    // catch it without clicking.
    await new Promise(r => setTimeout(r, 5000));
    let snap = await _meydaSnapshot(tab.id);
    if (trace) trace.meydaSnapshotInitial = snap;

    // If nothing useful captured yet, click the "הדפס" / "Print" button.
    // The previous debug showed this is the trigger that loads the PDF.
    let candidates = _buildMeydaCandidates(snap, finalUrl);
    if (candidates.length === 0) {
      const clickRes = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
          // Prefer exact-match "הדפס" / "הורד" / "Print" / "Download" buttons.
          const matches = [...document.querySelectorAll('button, [role="button"], a')]
            .filter(b => /^\s*(הדפס|הורד|print|download)\s*$/i.test(b.textContent || ''));
          // Fallback: contains-match
          const fuzzy = matches.length ? matches : [...document.querySelectorAll('button, [role="button"], a')]
            .filter(b => /הדפס|הורד|print|download/i.test(b.textContent || ''));
          for (const el of fuzzy) {
            try { el.click(); return { clicked: true, text: (el.textContent || '').trim().slice(0, 80), tag: el.tagName }; } catch {}
          }
          return { clicked: false };
        },
      });
      if (trace) trace.meydaClick = clickRes[0]?.result || null;
      if (clickRes[0]?.result?.clicked) {
        // Phase B — wait for the PDF to arrive after the click.
        await new Promise(r => setTimeout(r, 6000));
        snap = await _meydaSnapshot(tab.id);
        if (trace) trace.meydaSnapshotAfterClick = snap;
        candidates = _buildMeydaCandidates(snap, finalUrl);
      }
    }
    if (trace) trace.meydaCandidates = candidates;
    if (trace && snap?.printCalled) trace.meydaPrintCalled = true;
    // Try each candidate. First file response wins.
    for (const cu of candidates) {
      try {
        const absoluteUrl = new URL(cu, finalUrl).href;
        const r = await fetch(absoluteUrl, { credentials: 'include', redirect: 'follow' });
        if (!r.ok) continue;
        const rct = (r.headers.get('Content-Type') || '').toLowerCase();
        const rcd = (r.headers.get('Content-Disposition') || '').toLowerCase();
        if (isFileResponse(rct, rcd, r.url || absoluteUrl)) {
          const blob = await r.blob();
          const fn = filenameFromResponse(r)
                  || (sanitizeFilename(item.name) + (extFromCT(rct) || extFromUrl(absoluteUrl) || '.pdf'));
          if (trace) trace.meydaResolvedUrl = absoluteUrl;
          return [{ path: fn, blob }];
        }
      } catch {}
    }
    return null;
  } catch (e) {
    if (trace) trace.meydaError = String(e);
    return null;
  } finally {
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
  }
}

// Snapshot helper — grabs network log + DOM candidates from a meyda tab.
async function _meydaSnapshot(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => ({
      all: window.__mhMeydaAll || [],
      printCalled: !!window.__mhMeydaPrint,
      iframe: document.querySelector('iframe[src]')?.src || null,
      embed: document.querySelector('embed[src]')?.src || null,
      object: document.querySelector('object[data]')?.data || null,
      pdfDataUrl: document.querySelector('[data-pdf-url], [data-src*=".pdf" i]')?.getAttribute('data-pdf-url')
               || document.querySelector('[data-pdf-url], [data-src*=".pdf" i]')?.getAttribute('data-src')
               || null,
      anchorCandidates: [...document.querySelectorAll('a[href]')]
        .filter(a => /\.pdf|download|הורד|הדפס|print|syllabus|file|export/i.test((a.textContent || '') + ' ' + (a.getAttribute('href') || '')))
        .slice(0, 20)
        .map(a => a.href),
      buttonCandidates: [...document.querySelectorAll('button, [role="button"]')]
        .filter(b => /הדפס|הורד|print|download|export|save|שמור/i.test(b.textContent || ''))
        .slice(0, 20)
        .map(b => (b.textContent || '').trim().slice(0, 80)),
      bodyTextLen: (document.body?.innerText || '').length,
    }),
  });
  return result || {};
}

// Builds a dedup'd, junk-filtered, prioritised candidate URL list.
// Priority order:
//   1. Network captures with file-y content-type or .pdf in URL
//   2. window.open URLs (Angular often triggers PDF via window.open)
//   3. <iframe>/<embed>/<object> URLs (PDF viewers embed here)
//   4. data-pdf-url attributes
//   5. anchor candidates
function _buildMeydaCandidates(snap, baseUrl) {
  const out = [];
  const push = (u) => { if (u && !_isMeydaCandidateJunk(u)) out.push(u); };
  const all = snap.all || [];
  // Tier 1 — network entries that LOOK like files
  for (const e of all) {
    if (!e?.url) continue;
    const ct = e.contentType || '';
    if (/pdf|octet-stream|msword|officedocument|excel|powerpoint/i.test(ct)
        || /\.(pdf|docx?|pptx?|xlsx?)\b/i.test(e.url)) {
      push(e.url);
    }
  }
  // Tier 2 — window.open calls
  for (const e of all) {
    if (e?.kind === 'window.open') push(e.url);
  }
  // Tier 3 — embedded PDF viewers
  push(snap.iframe);
  push(snap.embed);
  push(snap.object);
  push(snap.pdfDataUrl);
  // Tier 4 — anchors
  for (const u of (snap.anchorCandidates || [])) push(u);
  // Tier 5 — last-resort: any meyda or ariel URL from the network log
  // that's NOT obviously a static asset.
  for (const e of all) {
    if (!e?.url) continue;
    try {
      const parsed = new URL(e.url, baseUrl);
      if (!/ariel\.ac\.il$/i.test(parsed.hostname)) continue;
      if (/\.(js|css|woff|woff2|ttf|otf|svg|png|jpg|jpeg|gif|webp|ico|json)(\?|#|$)/i.test(parsed.pathname)) continue;
      if (/loading-animation|chunk-|polyfills|main-/i.test(parsed.pathname)) continue;
      push(e.url);
    } catch {}
  }
  // Dedupe while preserving priority order.
  const seen = new Set();
  return out.filter(u => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

// Heuristic: does this response look like a downloadable file rather than HTML?
function isFileResponse(ct, cd, url) {
  if (ct.includes('text/html') || ct.includes('text/plain')) return false;
  if (cd.includes('attachment')) return true;
  if (/filename/i.test(cd)) return true;
  if (/pdf|octet-stream|msword|officedocument|excel|powerpoint|zip|x-rar|x-7z|epub|image\/|video\/|audio\//i.test(ct)) return true;
  if (/\.(pdf|docx?|pptx?|xlsx?|zip|rar|7z|epub|jpg|jpeg|png|gif|svg|mp3|mp4|mkv|mov)(\?|#|$)/i.test(url || '')) return true;
  return false;
}

async function fetchPage(item) {
  const res = await fetch(item.url, { credentials: 'include' });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const content = doc.querySelector('[role="main"] .box.generalbox, #region-main .no-overflow, #region-main') || doc.body;
  const out = [];
  const folder = sanitizeFilename(item.name) || `page_${item.id}`;

  for (const a of content.querySelectorAll('a[href*="pluginfile.php"]')) {
    try {
      const r = await fetch(a.href, { credentials: 'include' });
      if (!r.ok) continue;
      const blob = await r.blob();
      const fn = filenameFromResponse(r) || decodeURIComponent(a.href.split('/').pop()) || 'file';
      out.push({ path: `${folder}/${await maybePdfRename(fn, blob)}`, blob });
    } catch {}
  }
  if (content.textContent.trim()) {
    const wrapped = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>${escapeHtml(item.name)}</title><style>body{font-family:Segoe UI,Arial,sans-serif;max-width:780px;margin:24px auto;padding:0 16px;line-height:1.6}@media print{body{margin:0}}</style>${content.outerHTML}`;
    out.push({ path: `${folder}/index.html`, blob: new Blob([wrapped], { type: 'text/html;charset=utf-8' }) });
  }
  return out;
}

async function fetchBook(item) {
  const res = await fetch(item.url, { credentials: 'include' });
  const html = await res.text();
  return [{ path: `${sanitizeFilename(item.name)}.html`, blob: new Blob([html], { type: 'text/html;charset=utf-8' }) }];
}

// ========== ICS calendar ==========
function buildICS(events, courseName) {
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Moodle Hoarder//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  lines.push(`X-WR-CALNAME:${icsEsc(courseName || 'Moodle deadlines')}`);
  for (const e of events) {
    // Use "floating" time (no Z, no TZID) — this tells calendars to display
    // the event at the same wall-clock time regardless of timezone, which
    // matches what the user saw in Moodle. The previous UTC encoding led
    // calendars to apply timezone offsets and show wrong hours.
    const start = formatICSFloating(e.start);
    const end   = formatICSFloating(new Date(e.start.getTime() + 30 * 60 * 1000));
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${formatICSUtc(new Date())}`);
    lines.push(`SUMMARY:${icsEsc(e.summary)}`);
    lines.push(`DTSTART:${start}`);
    lines.push(`DTEND:${end}`);
    if (e.url) lines.push(`URL:${icsEsc(e.url)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEsc(e.description)}`);
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${icsEsc(e.summary)}`);
    lines.push('TRIGGER:-PT1D');
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function icsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\n/g, '\\n'); }
// Floating-time format: YYYYMMDDTHHMMSS (no Z, no TZID). Calendar interprets
// in its current local timezone — matching the user's clock at the time of
// the assignment, no surprise offsets.
function formatICSFloating(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
// DTSTAMP must be UTC per spec; this is just "when the ICS was generated"
// and doesn't affect event display.
function formatICSUtc(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// ========== Date parsing (he + en) ==========
const HE_MONTHS = { 'ינואר':0,'פברואר':1,'מרץ':2,'מרס':2,'אפריל':3,'מאי':4,'יוני':5,'יולי':6,'אוגוסט':7,'ספטמבר':8,'אוקטובר':9,'נובמבר':10,'דצמבר':11 };
const EN_MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseDate(text) {
  if (!text) return null;
  text = text.trim();

  // 1) "1 ביוני 2026, 23:55" / "1 ביוני 2026"
  let m = text.match(/(\d{1,2})\s+ב?([א-ת]+)\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const mo = HE_MONTHS[m[2]];
    if (mo != null) return new Date(+m[3], mo, +m[1], +m[4] || 23, +m[5] || 59);
  }
  // 2) "01/06/2026 23:55"  (DD/MM/YYYY)
  m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4] || 23, +m[5] || 59);
  // 3) "2026-06-01 23:55"
  m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4] || 23, +m[5] || 59);
  // 4) "1 June 2026, 23:55"
  m = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const mo = EN_MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo != null) return new Date(+m[3], mo, +m[1], +m[4] || 23, +m[5] || 59);
  }
  return null;
}

// ========== Helpers ==========
// Moodle often emits `Content-Disposition: filename="<UTF-8 bytes>"` directly
// instead of using RFC 5987. HTTP headers are transported as ISO-8859-1, so
// fetch() returns each byte as a Latin-1 char and we get mojibake (ÃÂ¡ etc).
// If we can re-encode each char as a single byte and parse it as valid
// UTF-8, that gives us the real string back.
function fixMojibake(s) {
  if (!s) return s;
  let nonAscii = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) return s;          // not Latin-1 single bytes; nothing to do
    if (c > 0x7f) nonAscii = true;
  }
  if (!nonAscii) return s;
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return s;
  }
}

function filenameFromResponse(res) {
  const cd = res.headers.get('Content-Disposition');
  if (!cd) return null;
  let m = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (m) { try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch {} }
  m = cd.match(/filename\s*=\s*"([^"]+)"/i);
  if (m) return fixMojibake(m[1]);
  m = cd.match(/filename\s*=\s*([^;]+)/i);
  if (m) return fixMojibake(m[1].trim());
  return null;
}
function extFromCT(ct) {
  if (!ct) return '';
  if (ct.includes('pdf')) return '.pdf';
  if (ct.includes('msword')) return '.doc';
  if (ct.includes('wordprocessingml')) return '.docx';
  if (ct.includes('presentationml')) return '.pptx';
  if (ct.includes('powerpoint')) return '.ppt';
  if (ct.includes('spreadsheetml')) return '.xlsx';
  if (ct.includes('excel')) return '.xls';
  if (ct.includes('zip')) return '.zip';
  if (ct.includes('rar')) return '.rar';
  return '';
}
function extFromUrl(u) {
  const m = u.match(/\.([a-z0-9]{2,5})(\?|#|$)/i);
  return m ? '.' + m[1].toLowerCase() : '';
}
function sanitizeFilename(name) {
  if (!name) return '';
  return String(name)
    // strip Unicode bidi marks and zero-width spaces (cause invisible chars in paths)
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
    // replace forbidden path chars (Windows + POSIX) with _
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    // collapse runs of whitespace
    .replace(/\s+/g, ' ')
    // collapse runs of underscores (was producing "_ _ _ _ _" strings)
    .replace(/[_\s]*_[_\s]*/g, '_')
    .replace(/^_+|_+$/g, '')
    // Windows doesn't allow trailing dot or space in folder/file names
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 120);
}
// ROADMAP #21 — if a PDF arrived with a generic filename and the user opted
// in, recover a real title from the PDF's own metadata (see pdf-title.js) and
// rename the file. Pure best-effort: any failure (not a PDF, no metadata,
// title still generic, oversized) returns the original name unchanged.
async function maybePdfRename(fn, blob) {
  try {
    if (!CACHED_SETTINGS?.renamePdfByTitle) return fn;
    if (typeof extractPdfTitle !== 'function' || typeof isGenericPdfName !== 'function') return fn;
    if (!/\.pdf$/i.test(fn) || !isGenericPdfName(fn)) return fn;
    if (!blob || blob.size > 64 * 1024 * 1024) return fn; // skip huge files
    const title = extractPdfTitle(new Uint8Array(await blob.arrayBuffer()));
    if (!title) return fn;
    const clean = sanitizeFilename(title);
    if (!clean || clean.length < 3 || isGenericPdfName(clean + '.pdf')) return fn;
    return clean + '.pdf';
  } catch { return fn; }
}
function uniquePath(used, path) {
  if (!used.has(path)) { used.add(path); return path; }
  const dot = path.lastIndexOf('.');
  const base = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : '';
  let i = 2;
  while (used.has(`${base} (${i})${ext}`)) i++;
  const p = `${base} (${i})${ext}`;
  used.add(p);
  return p;
}
function formatSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ===================== Zoom recordings (iteration 2) =====================
// Zoom LTI is a React SPA: recordings are <tr> rows, not <a href>. We scan
// table rows by content (topic + meeting ID + date) rather than by URL.

// Poll until row count is stable for ~1s, or 6s timeout.
async function waitForZoomList(tabId) {
  let last = -1, stable = 0;
  const start = Date.now();
  while (Date.now() - start < 6000) {
    let count = 0;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => document.querySelectorAll('table tbody tr, [role="rowgroup"] [role="row"]').length,
      });
      count = Math.max(0, ...results.map(r => r.result || 0));
    } catch {}
    if (count === last && count > 0) {
      stable += 500;
      if (stable >= 1000) return;
    } else {
      stable = 0;
    }
    last = count;
    await new Promise(r => setTimeout(r, 500));
  }
}

async function extractZoomRecordings(tabId) {
  let results = [];
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: scrapeZoomPage,
    });
  } catch (e) {
    return { pageUrl: '', recordings: [], debug: {}, frames: 0, error: e.message };
  }
  const out = { pageUrl: '', recordings: [], debug: {}, frames: results.length };
  for (const r of results) {
    if (!r?.result) continue;
    if (r.result.pageUrl && !out.pageUrl) out.pageUrl = r.result.pageUrl;
    out.recordings.push(...(r.result.recordings || []));
    Object.assign(out.debug, r.result.debug || {});
  }
  // Dedupe by meetingId+date (or by raw text if no id)
  const seen = new Set();
  out.recordings = out.recordings.filter(r => {
    const k = (r.meetingId || '') + '|' + (r.date || '') + '|' + (r.topic || '').slice(0, 30);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return out;
}

// Runs IN PAGE CONTEXT
function scrapeZoomPage() {
  // Zoom meeting IDs are 9-11 digits, usually displayed grouped: "843 9429 3109"
  const ZOOM_ID_RE = /\b(\d{3,4}\s+\d{3,4}\s+\d{3,4})\b/;
  // Dates: "May 19, 2025 8:42 AM" / "19/05/2025 8:42" / "2025-05-19"
  const DATE_RE = /(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}(?:[\s,]+\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)?|\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2})?|\d{4}-\d{1,2}-\d{1,2})/;
  // Duration: "1h 30m" / "45m" / "1 hr 30 min" (require word-boundary + space, to avoid catching meeting ID digits)
  const DUR_RE = /(?:^|\s)(\d{1,2}\s*(?:hr|hrs|hours|h)(?:\s*\d{1,2}\s*(?:min|mins|m))?|\d{1,3}\s*(?:min|mins|minutes)|\d{1,2}\s*(?:שעות|שעה)(?:\s*\d{1,2}\s*דקות)?|\d{1,3}\s*דקות)(?=\s|$)/i;

  const debug = { tables: 0, totalRows: 0, candidateRows: 0 };
  const recordings = [];

  // Strategy A: real <table> with <tbody><tr>
  const tables = document.querySelectorAll('table');
  debug.tables = tables.length;
  for (const table of tables) {
    const rows = table.querySelectorAll('tbody tr');
    debug.totalRows += rows.length;
    for (const row of rows) {
      const cells = [...row.querySelectorAll('td')];
      if (cells.length < 2) continue;
      const cellTexts = cells.map(c => (c.textContent || '').trim().replace(/\s+/g, ' ')).filter(Boolean);
      if (!cellTexts.length) continue;
      const joined = cellTexts.join('  ');
      const idMatch = joined.match(ZOOM_ID_RE);
      const dateMatch = joined.match(DATE_RE);
      const durMatch = joined.match(DUR_RE);
      // Skip rows that don't look like recording entries
      if (!idMatch && !dateMatch) continue;
      debug.candidateRows++;
      // Topic: pick the first cell that isn't ID/date/duration
      let topic = '';
      for (const t of cellTexts) {
        if (idMatch && t.includes(idMatch[0])) continue;
        if (dateMatch && t.includes(dateMatch[0])) continue;
        if (durMatch && t.trim() === (durMatch[1] || durMatch[0]).trim()) continue;
        if (/^\s*$/.test(t)) continue;
        topic = t;
        break;
      }
      if (!topic) topic = cellTexts[0] || '';
      recordings.push({
        topic,
        meetingId: idMatch ? idMatch[0].replace(/\s+/g, '') : '',
        date: dateMatch ? dateMatch[0] : '',
        duration: durMatch ? (durMatch[1] || durMatch[0]).trim() : '',
        rawCells: cellTexts,
      });
    }
  }

  // Strategy B: ARIA grid rows (some SPAs)
  if (!recordings.length) {
    const ariaRows = document.querySelectorAll('[role="row"]');
    debug.totalRows += ariaRows.length;
    for (const row of ariaRows) {
      const cellNodes = row.querySelectorAll('[role="cell"], [role="gridcell"]');
      if (cellNodes.length < 2) continue;
      const cellTexts = [...cellNodes].map(c => (c.textContent || '').trim().replace(/\s+/g, ' ')).filter(Boolean);
      const joined = cellTexts.join('  ');
      const idMatch = joined.match(ZOOM_ID_RE);
      const dateMatch = joined.match(DATE_RE);
      if (!idMatch && !dateMatch) continue;
      debug.candidateRows++;
      recordings.push({
        topic: cellTexts[0] || '',
        meetingId: idMatch ? idMatch[0].replace(/\s+/g, '') : '',
        date: dateMatch ? dateMatch[0] : '',
        duration: '',
        rawCells: cellTexts,
      });
    }
  }

  // Capture sample HTML for debugging when nothing matched
  if (!recordings.length) {
    const firstRow = document.querySelector('table tbody tr, [role="row"]');
    debug.firstRowHTML = firstRow ? firstRow.outerHTML.slice(0, 2000) : '(no rows in DOM)';
  }

  return { pageUrl: location.href, recordings, debug };
}

async function saveZoomFile(data) {
  const lines = [];
  lines.push('Moodle Hoarder — Zoom Recordings');
  lines.push('================================');
  lines.push(`Source: ${data.pageUrl || '(unknown)'}`);
  lines.push(`Date:   ${new Date().toLocaleString('he-IL')}`);
  lines.push(`Found:  ${data.recordings.length} recordings${data.pages > 1 ? ` (across ${data.pages} pages)` : ''}`);
  lines.push('');

  if (data.error) {
    lines.push('שגיאה בסריקה: ' + data.error);
    lines.push('');
  }

  if (!data.recordings.length) {
    lines.push('-- לא נמצאו הקלטות --');
    lines.push('');
    lines.push('סטטיסטיקות סריקה:');
    lines.push(`  טבלאות בדף: ${data.debug.tables ?? '?'}`);
    lines.push(`  סך השורות שנסרקו: ${data.debug.totalRows ?? '?'}`);
    lines.push(`  שורות שזוהו כמועמדות: ${data.debug.candidateRows ?? 0}`);
    lines.push(`  iframes שנסרקו: ${data.frames}`);
    lines.push('');
    lines.push('דברים שכדאי לבדוק:');
    lines.push('1. ודא שאתה רואה את רשימת ההקלטות מולך לפני שתלחץ "סרוק".');
    lines.push('2. נסה לעבור בין "Upcoming" ל-"Previous" tabs ולחזור.');
    lines.push('3. ודא שהדף נפתח דרך פעילות מודל (LTI launch) ולא ישירות מ-URL.');
    if (data.debug.firstRowHTML) {
      lines.push('');
      lines.push('-- HTML של שורה ראשונה שנמצאה (לדיבאג) --');
      lines.push(data.debug.firstRowHTML);
    }
  } else {
    lines.push('=========================================================');
    for (let i = 0; i < data.recordings.length; i++) {
      const r = data.recordings[i];
      lines.push('');
      lines.push(`#${i + 1}. ${r.topic || '(no topic)'}`);
      if (r.meetingId) lines.push(`    Meeting ID: ${r.meetingId}`);
      if (r.date)      lines.push(`    Date:       ${r.date}`);
      if (r.duration)  lines.push(`    Duration:   ${r.duration}`);
      if (r.page && data.pages > 1) lines.push(`    Page:       ${r.page}`);
      if (r.shareUrls && r.shareUrls.length) {
        if (r.shareUrls.length === 1) {
          lines.push(`    URL:        ${r.shareUrls[0]}`);
        } else {
          lines.push(`    URLs:`);
          for (const u of r.shareUrls) lines.push(`        ${u}`);
        }
      }
      if (r.error) lines.push(`    ⚠ Error:    ${r.error}`);
      if (r.rawCells && r.rawCells.length && !r.shareUrls?.length) {
        lines.push(`    Raw:        ${r.rawCells.join(' | ')}`);
      }
    }
    lines.push('');
    lines.push('=========================================================');
    lines.push('');
    const withUrls = data.recordings.filter(r => r.shareUrls?.length).length;
    if (withUrls > 0) {
      lines.push(`נמצאו קישורים ל-${withUrls} מתוך ${data.recordings.length} הקלטות.`);
      lines.push('');
      lines.push('הקישורים הם share-URLs — לחיצה תפתח דף שעושה אימות ומפנה');
      lines.push('ל-play-URL עם טוקן ה-tk. אם רוצים URL שעובד מכל מכשיר ללא');
      lines.push('לוגין, פתחו את הקישור, חכו שהנגן ייטען, והעתיקו את הכתובת');
      lines.push('מסרגל הכתובות אז.');
    } else {
      lines.push('לא נמצאו קישורים בדפי ה-detail.');
      lines.push('שלח HTML של דף detail אחד (אחרי קליק על הקלטה) להמשך טיפול.');
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const filename = `zoom-recordings_${date}.txt`;
  await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
  });
  await appendDownloadHistory({
    type: 'zoom-links', title: zoomHistoryTitle(data.recordings || []), sourceUrl: data.pageUrl || '',
    startedAt: Date.now(), finishedAt: Date.now(), status: 'success',
    itemCount: data.recordings?.length || 0, successCount: data.recordings?.filter(r => r.shareUrls?.length).length || 0,
    failedCount: data.recordings?.filter(r => r.error).length || 0, bytes: blob.size, filename,
  });
}

// ===== Pagination =====
// Walk through all pages of the Zoom recordings table. Clicks "Next", waits
// for rows to render, dedupes across pages. Stops when no new rows arrive
// or no Next button is found.
async function scrapeAllZoomPages(tabId, onProgress) {
  const all = [];
  const debug = {};
  const seen = new Set();
  let pageNum = 1;
  const MAX = 50;
  let pageUrl = '';

  while (pageNum <= MAX) {
    onProgress?.(`(עמוד ${pageNum}) ממתין שיטענו השורות...`);
    await waitForZoomList(tabId);
    onProgress?.(`(עמוד ${pageNum}) סורק...`);
    const data = await extractZoomRecordings(tabId);
    if (data.pageUrl) pageUrl = data.pageUrl;
    Object.assign(debug, data.debug || {});

    let added = 0;
    for (const r of data.recordings) {
      const key = (r.meetingId || '') + '|' + (r.date || '') + '|' + (r.topic || '').slice(0, 30);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ ...r, page: pageNum });
      added++;
    }
    onProgress?.(`(עמוד ${pageNum}) ${added} חדשים, סה"כ ${all.length}`);

    // If first page returned nothing useful, stop (the page isn't a recordings list)
    if (pageNum === 1 && all.length === 0) break;
    // If this page added nothing, we've already seen everything → done
    if (added === 0 && pageNum > 1) break;

    onProgress?.(`(עמוד ${pageNum}) מעבר לעמוד הבא...`);
    const advanced = await clickZoomNextPage(tabId);
    if (!advanced) break;
    // Give SPA time to swap rows, then waitForZoomList will confirm
    await new Promise(r => setTimeout(r, 800));
    pageNum++;
  }

  return { pageUrl, recordings: all, debug, frames: 0, pages: pageNum };
}

// Try several Next-button patterns, return true if we clicked one.
async function clickZoomNextPage(tabId) {
  let clickedAny = false;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const isDisabled = (el) => {
          if (!el) return true;
          if (el.disabled) return true;
          if (el.getAttribute('aria-disabled') === 'true') return true;
          const cls = (el.className || '').toString();
          if (/\b(is-)?disabled\b/i.test(cls)) return true;
          // Parent might carry the disabled state
          const parent = el.closest('[aria-disabled="true"], .disabled, .is-disabled');
          if (parent && parent !== document.body) return true;
          return false;
        };
        // Selector candidates ordered by specificity
        const selectors = [
          // Ant Design pagination (used by Zoom LTI)
          'li.ant-pagination-next:not(.ant-pagination-disabled) a',
          'li.ant-pagination-next:not(.ant-pagination-disabled)',
          '.ant-pagination-next:not(.ant-pagination-disabled)',
          'button[aria-label*="Next page" i]',
          'button[aria-label*="next" i]',
          'a[aria-label*="Next page" i]',
          'a[aria-label*="next" i]',
          '.zm-pagination__next',
          '[class*="pagination"] [class*="next"]:not([class*="disabled"])',
          'li.next:not(.disabled) a',
          'li.next:not(.disabled) button',
          '.pagination-next',
          '[data-testid*="next" i]',
        ];
        for (const sel of selectors) {
          for (const el of document.querySelectorAll(sel)) {
            if (isDisabled(el)) continue;
            el.click();
            return { clicked: true, via: sel };
          }
        }
        // Text-based fallback: "Next" / "הבא" / chevrons
        const textCandidates = ['next', 'הבא', '›', '»', '>'];
        for (const el of document.querySelectorAll('button, a, [role="button"]')) {
          if (isDisabled(el)) continue;
          const t = (el.textContent || '').trim().toLowerCase();
          if (textCandidates.includes(t)) {
            el.click();
            return { clicked: true, via: 'text:' + t };
          }
        }
        return { clicked: false };
      },
    });
    clickedAny = results.some(r => r?.result?.clicked);
  } catch {}
  return clickedAny;
}

// Same as clickZoomNextPage but for Previous.
async function clickZoomPrevPage(tabId) {
  let clickedAny = false;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const isDisabled = (el) => {
          if (!el) return true;
          if (el.disabled) return true;
          if (el.getAttribute('aria-disabled') === 'true') return true;
          const cls = (el.className || '').toString();
          if (/\b(is-)?disabled\b/i.test(cls)) return true;
          const parent = el.closest('[aria-disabled="true"], .disabled, .is-disabled');
          if (parent && parent !== document.body) return true;
          return false;
        };
        const selectors = [
          // Ant Design pagination
          'li.ant-pagination-prev:not(.ant-pagination-disabled) a',
          'li.ant-pagination-prev:not(.ant-pagination-disabled)',
          '.ant-pagination-prev:not(.ant-pagination-disabled)',
          'button[aria-label*="Previous page" i]',
          'button[aria-label*="previous" i]',
          'a[aria-label*="previous" i]',
          '.zm-pagination__prev',
          '[class*="pagination"] [class*="prev"]:not([class*="disabled"])',
          'li.prev:not(.disabled) a',
          'li.prev:not(.disabled) button',
          '.pagination-prev',
          '[data-testid*="prev" i]',
        ];
        for (const sel of selectors) {
          for (const el of document.querySelectorAll(sel)) {
            if (isDisabled(el)) continue;
            el.click();
            return true;
          }
        }
        const texts = ['previous', 'prev', 'הקודם', '‹', '«', '<'];
        for (const el of document.querySelectorAll('button, a, [role="button"]')) {
          if (isDisabled(el)) continue;
          const t = (el.textContent || '').trim().toLowerCase();
          if (texts.includes(t)) { el.click(); return true; }
        }
        return false;
      },
    });
    clickedAny = results.some(r => r?.result);
  } catch {}
  return clickedAny;
}

// ===== URL resolution (iteration 5) =====
// For each recording (in display order across pages), simulate a click on its
// table row, wait for the detail page to render, collect every /rec/share|play|download
// URL we can find, then navigate back. Processes from last page backwards so we
// don't need to find a "go to first page" button.
async function resolveZoomPlayUrls(tabId, recordings, onProgress) {
  for (const rec of recordings) {
    rec.shareUrls = [];
    rec.detailUrl = '';
    rec.error = null;
  }

  const totalPages = Math.max(1, ...recordings.map(r => r.page || 1));
  let recDone = 0;
  let debugHtml = null;
  // After scraping pagination we're on the last page. We don't actually
  // need to know that — every page iteration starts with an explicit
  // navigation to the target page number.
  let currentPage = null;

  for (let p = 1; p <= totalPages; p++) {
    const onPage = recordings.filter(r => (r.page || 1) === p);
    if (!onPage.length) continue;

    onProgress?.(`מעבר לעמוד ${p}...`);
    currentPage = await navigateToZoomPage(tabId, p, currentPage ?? totalPages);
    if (currentPage !== p) {
      // Couldn't get to the target page — mark all entries on it as such and skip.
      for (const rec of onPage) rec.error = `couldn't navigate to page ${p}`;
      continue;
    }
    await waitForZoomList(tabId);

    for (let i = 0; i < onPage.length; i++) {
      const rec = onPage[i];
      recDone++;
      const short = (rec.date || '').slice(0, 12);
      onProgress?.(`(${recDone}/${recordings.length}) [עמוד ${p}] ${rec.topic} — ${short}`);

      const clicked = await clickRecordingRow(tabId, i);
      if (!clicked) { rec.error = 'click failed'; continue; }

      const detail = await waitForDetailPage(tabId, 8000);
      rec.detailUrl = detail.url;
      rec.shareUrls = detail.urls;
      if (!rec.shareUrls.length) {
        const captured = await clickPlayAndCaptureUrl(tabId);
        if (captured.length) rec.shareUrls = captured;
        else rec.error = 'no URL on detail; play-button click captured nothing';
      }

      if (debugHtml === null) {
        const dump = await dumpCurrentPageHtml(tabId);
        if (dump?.html) debugHtml = { sourceUrl: dump.url || '', html: dump.html.slice(0, 800000) };
      }

      await navigateBackInZoom(tabId);
      const ok = await waitForListPage(tabId, 6000);
      if (!ok) rec.error = (rec.error ? rec.error + '; ' : '') + 'list did not restore';
    }
  }

  return debugHtml;
}

// Navigate to a specific page in the Zoom LTI pagination. Tries clicking the
// numbered item directly (Ant Design: .ant-pagination-item-N), then falls
// back to Next/Previous clicks one step at a time.
async function navigateToZoomPage(tabId, targetPage, currentPage) {
  if (currentPage === targetPage) return targetPage;

  // 1) Try direct click on the page number
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      args: [targetPage],
      func: (n) => {
        // Already active? Done.
        const active = document.querySelector('.ant-pagination-item-active');
        if (active && active.classList.contains(`ant-pagination-item-${n}`)) return 'already';
        // Click the page item (or its inner anchor)
        const item = document.querySelector(`.ant-pagination-item-${n}`);
        if (item) {
          const inner = item.querySelector('a');
          (inner || item).click();
          return 'clicked';
        }
        return 'not-found';
      },
    });
    if (results.some(r => r?.result === 'already' || r?.result === 'clicked')) {
      await new Promise(r => setTimeout(r, 800));
      await waitForZoomList(tabId);
      return targetPage;
    }
  } catch {}

  // 2) Fall back to one-step clicks
  while (currentPage < targetPage) {
    const ok = await clickZoomNextPage(tabId);
    if (!ok) return currentPage;
    await new Promise(r => setTimeout(r, 800));
    await waitForZoomList(tabId);
    currentPage++;
  }
  while (currentPage > targetPage) {
    const ok = await clickZoomPrevPage(tabId);
    if (!ok) return currentPage;
    await new Promise(r => setTimeout(r, 800));
    await waitForZoomList(tabId);
    currentPage--;
  }
  return currentPage;
}

// Click the i'th row in the table that contains zoom meeting IDs.
async function clickRecordingRow(tabId, rowIdx) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      args: [rowIdx],
      func: (idx) => {
        const ZOOM_ID_RE = /\b\d{3,4}\s+\d{3,4}\s+\d{3,4}\b/;
        let target = null;
        for (const table of document.querySelectorAll('table')) {
          for (const row of table.querySelectorAll('tbody tr')) {
            if (ZOOM_ID_RE.test(row.textContent || '')) { target = table; break; }
          }
          if (target) break;
        }
        if (!target) return false;
        const rows = target.querySelectorAll('tbody tr');
        const row = rows[idx];
        if (!row) return false;
        // Prefer the topic link / explicit button
        const link = row.querySelector('a[href]:not([href="#"]):not([href^="javascript"])');
        if (link) { link.click(); return true; }
        const btn = row.querySelector('button:not([disabled]), [role="button"]');
        if (btn) { btn.click(); return true; }
        // React onClick on the row itself
        row.click();
        return true;
      },
    });
    return results.some(r => r?.result === true);
  } catch { return false; }
}

// Wait until the recording detail page is rendered (the play button is there).
// Resolves immediately once the play element shows up. Also opportunistically
// returns any zoom URLs visible on the page (rare but possible).
// Previously this polled for zoom URLs that never appear without clicking play,
// so every recording wasted the full 8s timeout. Now typical resolution is
// 600-1500ms.
async function waitForDetailPage(tabId, timeoutMs = 6000) {
  const start = Date.now();
  let detailUrl = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          // Primary signal: the play button is rendered.
          const playReady = !!document.querySelector(
            '.lti-recording-item-play-media, [class*="play-media"], [title="Play"], [aria-label*="play" i][role="button"]'
          );
          if (!playReady) return null;
          // Opportunistic passive URL scrape — these rarely exist on detail
          // before play is clicked, but if they do we save a click.
          const REC_RE = /https?:\/\/[^\s"'<>]*zoom\.us\/[^\s"'<>?#]*(?:rec|recording)\/[^\s"'<>?#]+(?:\?[^\s"'<>#]*)?/g;
          const found = new Set();
          for (const a of document.querySelectorAll('a[href]')) {
            if (/zoom\.us\/(?:rec|recording)\//.test(a.href)) found.add(a.href);
          }
          for (const el of document.querySelectorAll('input, textarea')) {
            const v = (el.value ?? '').toString();
            const ms = v.match(REC_RE);
            if (ms) ms.forEach(u => found.add(u));
          }
          return { url: location.href, urls: [...found] };
        },
      });
      const hit = results.find(r => r?.result);
      if (hit) {
        const all = new Set();
        for (const r of results) for (const u of (r?.result?.urls || [])) all.add(u);
        return { url: hit.result.url, urls: [...all] };
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return { url: detailUrl, urls: [] };
}

// Capture the full body HTML of the current page (for debugging unknown layouts).
async function dumpCurrentPageHtml(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => ({
        url: location.href,
        html: (document.body && document.body.outerHTML) || '',
      }),
    });
    // Pick the largest payload (likely the detail content frame, not chrome)
    let best = null;
    for (const r of results) {
      if (!r?.result?.html) continue;
      if (!best || r.result.html.length > best.html.length) best = r.result;
    }
    return best;
  } catch { return null; }
}

// Navigate back from detail to list: prefer the Ant breadcrumb link Zoom uses,
// fall back to history.back().
async function navigateBackInZoom(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        // Zoom LTI uses Ant breadcrumbs: first .ant-breadcrumb-link contains a clickable span.
        const breadcrumb = document.querySelector('.ant-breadcrumb');
        if (breadcrumb) {
          // Find the first clickable link in the breadcrumb (typically "Course Recordings")
          const btn = breadcrumb.querySelector('[role="button"], a[href]:not([href="#"])');
          if (btn) { btn.click(); return; }
        }
        const sel = [
          '[aria-label*="back" i]',
          'button[class*="back" i]',
          '[class*="back-button" i]',
          '[class*="breadcrumb"] a:first-child',
          '[class*="breadcrumb"] [class*="link"]:first-child',
        ];
        for (const s of sel) {
          const el = document.querySelector(s);
          if (el && el.offsetParent !== null) { el.click(); return; }
        }
        history.back();
      },
    });
  } catch {}
  await new Promise(r => setTimeout(r, 250));
}

// On the recording detail page, click the play button (Zoom's
// `.lti-recording-item-play-media` span) and capture the URL Zoom tries to
// open via window.open. This runs in MAIN world so we can override the
// real window.open of the page.
async function clickPlayAndCaptureUrl(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: async () => {
        const origOpen = window.open;
        const captured = [];
        // Replace window.open with a capturer that returns a fake window so
        // Zoom's caller code doesn't choke on `.focus()`, `.postMessage()`, etc.
        const fakeWin = {
          closed: false,
          location: { href: '', replace() {}, assign(u) { captured.push(String(u)); } },
          close() { this.closed = true; },
          focus() {}, blur() {}, postMessage() {},
          document: { write() {}, writeln() {}, close() {} },
        };
        window.open = function (url) {
          if (url) captured.push(String(url));
          fakeWin.location.href = String(url || '');
          return fakeWin;
        };

        // Also intercept programmatic <a target="_blank"> clicks via createElement('a').click()
        const origClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          if (this.href && this.target === '_blank') {
            captured.push(this.href);
            return;
          }
          return origClick.apply(this, arguments);
        };

        const restore = () => {
          window.open = origOpen;
          HTMLAnchorElement.prototype.click = origClick;
        };

        try {
          const btn = document.querySelector('.lti-recording-item-play-media')
                   || document.querySelector('[class*="play-media"]')
                   || document.querySelector('[title="Play"]')
                   || document.querySelector('[aria-label*="play" i][role="button"]');
          if (!btn) { restore(); return { error: 'play button not found', captured: [] }; }

          // Race: resolve as soon as window.open fires (with a short grace
          // period to catch any follow-up calls), otherwise fall back to a
          // 3s hard timeout. Previously this was a fixed 2.5s wait every time.
          const result = await new Promise((resolve) => {
            const finish = () => { restore(); resolve({ captured }); };
            let graceTimer = null;
            const onCapture = () => {
              clearTimeout(hardTimer);
              clearTimeout(graceTimer);
              graceTimer = setTimeout(finish, 150);
            };
            const wrappedOpen = window.open;
            window.open = function (url) {
              const r = wrappedOpen.apply(this, arguments);
              onCapture();
              return r;
            };
            const wrappedClick = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () {
              const r = wrappedClick.apply(this, arguments);
              if (this.href && this.target === '_blank') onCapture();
              return r;
            };
            const hardTimer = setTimeout(finish, 3000);
            btn.click();
          });
          return result;
        } catch (e) {
          restore();
          return { error: String(e), captured };
        }
      },
    });
    const all = new Set();
    for (const r of results) {
      if (r?.result?.captured) for (const u of r.result.captured) if (u) all.add(u);
    }
    return [...all];
  } catch {
    return [];
  }
}

// Wait until the recordings table reappears with rows. Polling tightened
// to 200ms / 100ms settle from 400ms / 300ms — typical recovery is <500ms.
async function waitForListPage(tabId, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const ZOOM_ID_RE = /\b\d{3,4}\s+\d{3,4}\s+\d{3,4}\b/;
          for (const table of document.querySelectorAll('table')) {
            for (const row of table.querySelectorAll('tbody tr')) {
              if (ZOOM_ID_RE.test(row.textContent || '')) return true;
            }
          }
          return false;
        },
      });
      if (results.some(r => r?.result === true)) {
        await new Promise(r => setTimeout(r, 100));
        return true;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

// ===== Grades export =====
// Scrapes Moodle's Grader Report (User View) for the course and returns CSV.
// Hebrew Moodle uses "/grade/report/user/index.php?id=<courseId>" by default;
// some courses redirect to /grade/report/index.php. We try the user-view first.
async function fetchGradesCsv(courseId) {
  const base = 'https://moodlearn.ariel.ac.il';
  const urls = [
    `${base}/grade/report/user/index.php?id=${courseId}`,
    `${base}/grade/report/overview/index.php?id=${courseId}`,
    `${base}/grade/report/index.php?id=${courseId}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) continue;
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const rows = parseGradesTable(doc);
      if (rows.length) return rowsToCsv(rows);
    } catch {}
  }
  return null;
}

function parseGradesTable(doc) {
  // Look for any table that has "Grade item" / "פריט ציון" / "ציון" semantics.
  const tables = doc.querySelectorAll('table.user-grade, table.gradereport-user, table.boxaligncenter, #user-grade');
  for (const t of tables.length ? tables : doc.querySelectorAll('table')) {
    const rows = [...t.querySelectorAll('tr')];
    if (rows.length < 2) continue;
    const parsed = rows.map(tr => {
      return [...tr.querySelectorAll('th, td')].map(c => (c.textContent || '').trim().replace(/\s+/g, ' '));
    }).filter(r => r.some(c => c));
    // Heuristic: must have a header row with at least 2 columns and "ציון"/"Grade"
    const hdr = parsed[0]?.join(' ').toLowerCase() || '';
    if (parsed[0]?.length >= 2 && (/ציון|grade|item/i.test(hdr))) return parsed;
  }
  return [];
}

function rowsToCsv(rows) {
  const esc = (s) => {
    s = String(s ?? '');
    return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n');
}

// ===================== Dashboard deadlines =====================
// On moodlearn.ariel.ac.il/my/, reads the "ממתין לביצוע" timeline rows from
// the live tab, cross-references the hidden set used by content_dashboard.js,
// compares with the previous snapshot to mark new/updated items, and renders
// a picker + ICS export.

async function scanDeadlinesInActiveTab(tabId) {
  // Wait briefly for the timeline cards to settle in case the page is still
  // hydrating when the popup opens.
  let last = -1, stable = 0;
  const start = Date.now();
  while (Date.now() - start < 4000) {
    let count = 0;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.querySelectorAll(
          '[data-region="event-list-item"], [data-region="dashboard-timeline-event"],' +
          ' [data-region="upcoming-event-list-item"], .event-list-item, .timeline-event-list-item'
        ).length,
      });
      count = results[0]?.result || 0;
    } catch {}
    if (count === last && count > 0) {
      stable += 400;
      if (stable >= 800) break;
    } else stable = 0;
    last = count;
    await new Promise(r => setTimeout(r, 400));
  }
  // Now extract.
  let extracted = [];
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractDeadlinesFromPage,
    });
    extracted = results[0]?.result || [];
  } catch {}
  return extracted;
}

// Runs IN PAGE CONTEXT. Pulls each timeline row's id, title, course,
// due timestamp, and late flag.
function extractDeadlinesFromPage() {
  const out = [];
  const selectors = [
    '[data-region="event-list-item"]',
    '[data-region="dashboard-timeline-event"]',
    '[data-region="upcoming-event-list-item"]',
    '.event-list-item',
    '.timeline-event-list-item',
  ];
  let rows = [];
  for (const sel of selectors) {
    rows = document.querySelectorAll(sel);
    if (rows.length) break;
  }
  for (const row of rows) {
    const link = row.querySelector('a[href*="/mod/"]');
    let id = '';
    if (link?.href) {
      const m = link.href.match(/\/mod\/([a-z0-9_-]+)\/view\.php\?(?:[^#]*&)?id=(\d+)/i);
      id = m ? `${m[1]}:${m[2]}` : link.href.split('#')[0];
    } else {
      const titleEl = row.querySelector('h3, h4, h5, [class*="event-name"], [class*="event-title"]');
      id = 'text:' + (titleEl?.textContent || row.textContent || '').trim().slice(0, 80);
    }

    const titleEl = row.querySelector('h3, h4, h5, .event-name, [class*="event-name"], [class*="event-title"]');
    const title = (titleEl?.textContent || link?.textContent || row.textContent || '')
      .replace(/\s+/g, ' ').trim();

    const courseEl = row.querySelector(
      '[data-region="event-list-content-course"], .course-name, .event-course,'
      + ' [class*="course-name"], [class*="course-title"]'
    );
    const course = (courseEl?.textContent || '').replace(/\s+/g, ' ').trim();

    // Pick the right "container" for this row — walk up until the parent
    // contains ANOTHER event. Going further would pull in dates that belong
    // to other rows (that's why the previous version applied one date to
    // every item). The container is the largest wrapper that's still
    // exclusive to this row.
    const eventSel =
      '[data-region="event-list-item"], [data-region="dashboard-timeline-event"],' +
      ' [data-region="upcoming-event-list-item"], .event-list-item, .timeline-event-list-item';
    let container = row;
    for (let i = 0; i < 5; i++) {
      if (!container.parentElement) break;
      const parent = container.parentElement;
      const others = [...parent.querySelectorAll(eventSel)]
        .filter(e => e !== row && !e.contains(row) && !row.contains(e));
      if (others.length > 0) break;
      container = parent;
      if (container.matches?.('[data-block="timeline"], .block_timeline, [data-region="event-list-content"], [data-region="timeline-events"]')) break;
    }

    function parseScope(scope) {
      if (!scope) return null;
      // 1. data-timestamp / data-* conventions
      const dataSelectors = ['[data-timestamp]', '[data-due]', '[data-event-time]', '[data-start-timestamp]', '[data-time]'];
      for (const sel of dataSelectors) {
        const el = scope.querySelector?.(sel);
        if (!el) continue;
        for (const key of ['timestamp', 'due', 'eventTime', 'startTimestamp', 'time']) {
          const v = +el.dataset[key];
          if (!isNaN(v) && v > 0) {
            // Could be seconds or ms
            return v < 1e12 ? v * 1000 : v;
          }
        }
      }
      // 2. <time datetime="...">
      const timeEl = scope.querySelector?.('time[datetime]');
      if (timeEl?.dateTime) {
        const t = new Date(timeEl.dateTime).getTime();
        if (!isNaN(t)) return t;
      }
      // 3. Visible text — strip bidi marks first (Hebrew Moodle often
      // embeds LRM/RLM around numbers, which can split regex matches).
      const text = (scope.textContent || '').replace(/[‎‏‪-‮⁦-⁩﻿]/g, '');
      const dateM = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
      if (!dateM) return null;
      const day = +dateM[1], month = +dateM[2] - 1, year = +dateM[3];

      // Find the time CLOSEST to the date string — prefer the one that
      // appears right after the date, then right before. This avoids
      // picking up unrelated times like "updated 10:30 ago".
      let hour = 23, min = 59;
      const afterDate = text.slice(dateM.index + dateM[0].length);
      let m = /^[^0-9]{0,15}(\d{1,2}):(\d{2})/.exec(afterDate);
      if (!m) {
        const beforeDate = text.slice(0, dateM.index);
        m = /(\d{1,2}):(\d{2})[^0-9]{0,15}$/.exec(beforeDate);
      }
      if (m) {
        const h = +m[1], mm = +m[2];
        if (h < 24 && mm < 60) { hour = h; min = mm; }
      }
      const t = new Date(year, month, day, hour, min).getTime();
      return isNaN(t) ? null : t;
    }

    let due = parseScope(container);

    // If the container didn't have a date, the date is probably in a
    // short label sibling just before the container (day-headers laid out
    // as siblings rather than wrappers). Walk back through up to 3 short
    // siblings, stopping at another event.
    if (!due) {
      let sib = container.previousElementSibling;
      for (let i = 0; i < 3 && sib && !due; i++) {
        const txt = (sib.textContent || '').trim();
        if (sib.matches?.(eventSel) || sib.querySelector?.(eventSel)) break;
        if (txt && txt.length < 120) {
          due = parseScope(sib);
          if (due) break;
        }
        sib = sib.previousElementSibling;
      }
    }
    // Last-ditch: try the row by itself.
    if (!due) due = parseScope(row);

    const late = /באיחור|overdue|late/i.test(row.textContent || '');

    out.push({
      id, title, course, due, late,
      url: link?.href || '',
    });
  }
  return out;
}

// Cross-reference the user's "hidden" set + previous snapshot to attach
// status flags: { kind: 'late'|'thisWeek'|'future', change: 'new'|'updated'|null }.
async function annotateDeadlines(deadlines) {
  const stored = await chrome.storage.local.get(['hiddenDeadlines', 'deadlinesSnapshot']);
  const hidden = new Set(stored.hiddenDeadlines || []);
  const prev = stored.deadlinesSnapshot?.deadlines || [];
  // First-ever scan? Don't mark everything as "חדש" — there's nothing to
  // compare against. The snapshot will be saved at the end of this scan
  // so the next visit can actually mark new items.
  const hasPrev = prev.length > 0;
  const prevMap = new Map(prev.map(d => [d.id, d]));
  const now = Date.now();
  const weekFromNow = now + 7 * 24 * 60 * 60 * 1000;

  const visible = deadlines.filter(d => !hidden.has(d.id));

  for (const d of visible) {
    if (!d.due) d.kind = 'unknown';
    else if (d.late || d.due < now) d.kind = 'late';
    else if (d.due <= weekFromNow) d.kind = 'thisWeek';
    else d.kind = 'future';

    if (!hasPrev) {
      d.change = null;
    } else {
      const pv = prevMap.get(d.id);
      if (!pv) d.change = 'new';
      else if (pv.due !== d.due) d.change = 'updated';
      else d.change = null;
    }
  }
  return visible;
}

function renderDeadlines() {
  showView('deadlines');
  const listEl = document.getElementById('deadlinesList');
  listEl.innerHTML = '';

  // Sort: late first, then this-week, then future, then unknown-due last.
  const order = { late: 0, thisWeek: 1, future: 2, unknown: 3 };
  const sorted = [...deadlinesScanned.deadlines]
    .sort((a, b) => (order[a.kind] - order[b.kind]) || ((a.due || Infinity) - (b.due || Infinity)));

  const summary = document.getElementById('deadlinesSummary');
  const late = sorted.filter(d => d.kind === 'late').length;
  const week = sorted.filter(d => d.kind === 'thisWeek').length;
  const updated = sorted.filter(d => d.change === 'updated').length;
  const news = sorted.filter(d => d.change === 'new').length;
  const parts = [`${sorted.length} מטלות`];
  if (late) parts.push(`<span style="color:#b00020;font-weight:600">${late} באיחור</span>`);
  if (week) parts.push(`<span style="color:#dc2867;font-weight:600">${week} השבוע</span>`);
  if (news) parts.push(`<span style="color:#1b5e20">${news} חדשות</span>`);
  if (updated) parts.push(`<span style="color:#7a4e00">${updated} עודכנו</span>`);
  summary.innerHTML = parts.join(' · ');

  for (const d of sorted) {
    const li = document.createElement('li');
    li.dataset.id = d.id;
    const date = d.due ? new Date(d.due).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    const badges = [];
    if (d.kind === 'late') badges.push(`<span class="chip" style="background:#b00020;color:white;border-radius:10px;padding:2px 8px;font-size:9px;">באיחור</span>`);
    else if (d.kind === 'thisWeek') badges.push(`<span class="chip" style="background:#dc2867;color:white;border-radius:10px;padding:2px 8px;font-size:9px;">השבוע</span>`);
    if (d.change === 'new') badges.push(`<span class="chip" style="background:var(--ok);color:white;border-radius:10px;padding:2px 8px;font-size:9px;">חדש</span>`);
    if (d.change === 'updated') badges.push(`<span class="chip" style="background:var(--new-bg);color:var(--new-fg);border-radius:10px;padding:2px 8px;font-size:9px;">עודכן</span>`);

    li.innerHTML = `
      <input type="checkbox" checked>
      <div style="flex:1;overflow:hidden;">
        <div class="name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
        <div class="id"></div>
        <div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;">${badges.join('')}</div>
      </div>`;
    li.querySelector('.name').textContent = d.title || '(ללא כותרת)';
    li.querySelector('.id').textContent = `${date}${d.course ? ' · ' + d.course : ''}`;
    listEl.appendChild(li);
  }

  document.getElementById('totDeadlines').textContent = sorted.length;
  setStatus('');
}

document.getElementById('backDeadlines')?.addEventListener('click', () => {
  showView('initial');
  $('scan').disabled = false;
  resetFooter();
});

document.getElementById('exportDeadlines')?.addEventListener('click', async () => {
  if (!deadlinesScanned) return;
  const listEl = document.getElementById('deadlinesList');
  const checked = new Set(
    [...listEl.querySelectorAll('li')]
      .filter(li => li.querySelector('input').checked)
      .map(li => li.dataset.id)
  );
  const selected = deadlinesScanned.deadlines.filter(d => checked.has(d.id) && d.due);
  if (!selected.length) {
    setStatus(t('status.no.deadlines.selected'));
    return;
  }

  const events = selected.map(d => ({
    uid: `dashboard-${d.id}@moodle-hoarder`,
    summary: d.title + (d.course ? ` (${d.course})` : ''),
    start: new Date(d.due),
    url: d.url,
    description: `מטלה במודל${d.course ? ' — ' + d.course : ''}`,
  }));
  const ics = buildICS(events, 'Moodle deadlines');
  const blob = new Blob(['﻿' + ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const filename = `moodle-deadlines_${new Date().toISOString().slice(0, 10)}.ics`;
  await chrome.downloads.download({ url, filename, saveAs: !!CACHED_SETTINGS?.saveAs });

  // Save snapshot for next-time "updated" comparison
  await chrome.storage.local.set({
    deadlinesSnapshot: {
      date: Date.now(),
      deadlines: deadlinesScanned.deadlines.map(d => ({ id: d.id, due: d.due })),
    },
  });

  setStatus(t('status.exported.deadlines', { n: selected.length }));
  notify('Moodle Hoarder', `${selected.length} מטלות נשמרו ליומן`);
});
