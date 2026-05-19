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
function showView(name) {
  initialView.style.display = name === 'initial' ? 'block' : 'none';
  pickerView.style.display  = name === 'picker'  ? 'block' : 'none';
  multiView.style.display   = name === 'multi'   ? 'block' : 'none';
  const zoomView = document.getElementById('zoomPicker');
  if (zoomView) zoomView.style.display = name === 'zoom' ? 'block' : 'none';
  const dlView = document.getElementById('deadlinesView');
  if (dlView) dlView.style.display = name === 'deadlines' ? 'block' : 'none';
}

// Settings button opens the options page in a new tab.
document.getElementById('openSettings')?.addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
});

// Bootstrap: load settings into the cache before anything else runs.
// Also auto-trigger the dashboard deadlines scan when the popup opens on
// /my/ — the user doesn't need to press "סרוק" there; opening the popup
// is already an explicit intent.
(async () => {
  await loadCachedSettings();
  await refreshQueueArea();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /moodlearn\.ariel\.ac\.il\/my\/?(?:[?#]|$|index\.php)/.test(tab.url)) {
      await runDashboardScan(tab);
    }
  } catch {}
})();

// Dashboard scan: shared between auto-bootstrap and the manual scan button
// (in case the auto-scan needs to be retried).
async function runDashboardScan(tab) {
  $('scan').disabled = true;
  setStatus('פותח את כל הפעילויות...');
  try {
    await expandTimelineActivities(tab.id);
    setStatus('סורק דדליינים...');
    const deadlines = await scanDeadlinesInActiveTab(tab.id);
    if (!deadlines.length) {
      setStatus('לא נמצאו מטלות. ודא שטעון "ממתין לביצוע" ונסה שוב.');
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
    setStatus('שגיאה: ' + e.message);
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
  if (!confirm('לרוקן את התור?')) return;
  await setQueue([]);
  await refreshQueueArea();
});

document.getElementById('downloadQueue')?.addEventListener('click', async () => {
  const q = await getQueue();
  if (!q.length) return;
  document.getElementById('downloadQueue').disabled = true;
  setStatus(`מוריד ${q.length} פריטים בתור...`);
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
    setStatus('כשל בהורדת התור.');
    document.getElementById('downloadQueue').disabled = false;
    return;
  }
  setStatus('מארז ZIP...');
  const zipBlob = await buildZip(files);
  const url = URL.createObjectURL(zipBlob);
  const filename = `moodle-hoarder-queue-${new Date().toISOString().slice(0, 10)}.zip`;
  await chrome.downloads.download({ url, filename, saveAs: !!CACHED_SETTINGS?.saveAs });
  await setQueue([]);
  await refreshQueueArea();
  setStatus(`הושלם: ${files.length} פריטים, ${formatSize(zipBlob.size)}.`);
  notify('Moodle Hoarder', `הורדו ${files.length} פריטים מהתור`);
  document.getElementById('downloadQueue').disabled = false;
});

// ---------- Initial: scan button ----------
$('scan').addEventListener('click', async () => {
  $('scan').disabled = true;
  setStatus('בודק עמוד...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) throw new Error('אין טאב פעיל');

    if (/zoom\.us/.test(tab.url)) {
      setStatus('ממתין שדף ה-Zoom ייטען...');
      const data = await scrapeAllZoomPages(tab.id, (s) => setStatus(s));
      if (data.recordings.length === 0) {
        await saveZoomFile(data);
        setStatus('לא נמצאו הקלטות. ראה את הקובץ שירד לפרטים.');
        $('scan').disabled = false;
        return;
      }
      zoomScanned = { data, tabId: tab.id };
      renderZoomPicker();
      return;
    } else if (/moodlearn\.ariel\.ac\.il\/my\/courses\.php/.test(tab.url)) {
      setStatus('סורק קורסים...');
      // Moodle 4.x's "My Courses" page renders the cards via JS after page
      // load, so fetching the URL fresh returns an empty skeleton. Read the
      // live DOM from the active tab instead.
      const courses = await scanCoursesInActiveTab(tab.id);
      if (!courses.length) {
        setStatus('לא נמצאו קורסים. גלול מטה כדי שכל הקורסים יטענו ונסה שוב.');
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
      setStatus('סורק קורס...');
      scanned = await scanCourse(tab.url);
      if (!scanned.sections.length) {
        setStatus('לא נמצאו פריטים בדף.');
        $('scan').disabled = false;
        return;
      }
      renderPicker();
    } else {
      setStatus('יש לעבור לדף קורס במודל אריאל או לדף "הקורסים שלי".');
      $('scan').disabled = false;
    }
  } catch (e) {
    setStatus('שגיאה: ' + e.message);
    $('scan').disabled = false;
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
      diffText.textContent = `נמצאה הורדה לא-גמורה מ-${formatDateShort(ckpt.startedAt)} (${cachedCount} פריטים כבר ירדו). הם יישמרו וההורדה תמשיך משם.`;
      diffBanner.classList.add('show');
      return;
    }
    if (scanned.prevSeen && scanned.prevSeen.items?.length) {
      const newCount = countNew();
      diffText.textContent = `נמצאה הורדה קודמת מתאריך ${formatDateShort(scanned.prevSeen.lastDownload)} — ${newCount} פריטים חדשים מאז.`;
      diffBanner.classList.add('show');
    } else {
      diffBanner.classList.remove('show');
    }
  })();

  updateSelCount();
  setStatus('');
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
  return defChecked ? 'חדש' : 'לא בדיפולט';
}

function countNew() {
  let n = 0;
  scanned.sections.forEach((sec, sIdx) => sec.items.forEach(it => {
    if (diffStatus(scanned.prevSeen, it, defaultChecked(it, sIdx)) === 'חדש') n++;
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
function renderMulti() {
  showView('multi');
  coursesEl.innerHTML = '';
  totCoursesEl.textContent = multiScanned.courses.length;
  for (const c of multiScanned.courses) {
    const li = document.createElement('li');
    li.dataset.id = c.id;
    li.innerHTML = `
      <input type="checkbox" checked>
      <div style="flex:1;overflow:hidden;">
        <div class="name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
        <div class="id">ID ${c.id}</div>
      </div>`;
    li.querySelector('.name').textContent = c.name;
    li.querySelector('input').addEventListener('change', updateCourseCount);
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
  $('downloadZoom').disabled = n === 0;
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

$('downloadZoom').addEventListener('click', async () => {
  if (!zoomScanned) return;
  $('downloadZoom').disabled = true;
  $('backZoom').disabled = true;
  const allRecs = zoomScanned.data.recordings;
  const checkedIds = new Set();
  $('zoomItems').querySelectorAll('li').forEach(li => {
    if (li.querySelector('input').checked) checkedIds.add(li.dataset.id);
  });
  const selected = allRecs.filter(r =>
    checkedIds.has(`${r.meetingId || ''}|${r.date || ''}|${(r.topic || '').slice(0, 30)}`));
  if (!selected.length) { $('backZoom').disabled = false; return; }

  setStatus(`מתחיל פענוח קישורים ל-${selected.length} הקלטות — אל תסגור!`);
  const debugHtml = await resolveZoomPlayUrls(zoomScanned.tabId, selected, (s) => setStatus(s));

  // Output file contains only the selected recordings
  const outData = { ...zoomScanned.data, recordings: selected };
  await saveZoomFile(outData);
  const ok = selected.filter(r => r.shareUrls?.length).length;
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
    setStatus(`לא נמצאו URLs. הורד גם zoom-detail-debug HTML.`);
  } else {
    setStatus(`הושלם: ${ok}/${selected.length} קישורים נמצאו.`);
  }
  notify('Moodle Hoarder', `Zoom: ${ok}/${selected.length} קישורים נחלצו`);
  $('backZoom').disabled = false;
});

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
      if (!items.length) { logLine(`— ${c.name}: אין מה להוריד`, 'ok'); continue; }
      await runDownload({
        courseName: data.courseName,
        courseId: data.courseId,
        courseUrl: c.url,
        items,
        silent: true,
      });
      logLine(`✓ ${c.name}: ${items.length} פריטים`, 'ok');
    } catch (e) {
      logLine(`✗ ${c.name}: ${e.message}`, 'err');
    }
  }
  setStatus('הושלם.');
  setProgress(0, 0);
  notify('Moodle Hoarder', `הסתיימה הורדת ${wanted.length} קורסים`);
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

  const files = [];
  const links = [];      // generic URL activities
  const recordings = []; // streaming
  const events = [];     // calendar deadlines
  const used = new Set();

  // Phase 1: parallel fetch with checkpoint resume on courseId.
  setStatus(`מוריד ${items.length} פריטים במקביל (עד ${CONCURRENT_DOWNLOADS} בו-זמנית)...`);
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
      if (!silent) logLine(`✗ שליפת ציונים: ${e.message}`, 'err');
    }
  }
  const info = buildInfo({ courseName, courseUrl, items, files, links, recordings, events, errors });
  files.push({ path: 'info.txt', blob: textBlob(info) });

  setStatus(`מארז ZIP...`);
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
  }

  setStatus(`הושלם: ${files.length} פריטים, ${formatSize(zipBlob.size)}.`);
  if (!silent) notify('Moodle Hoarder', `הורדו ${files.length} פריטים מ-"${courseName}"`);
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
    if (!fileUrl) throw new Error('לא נמצא קובץ');
    res = await fetch(fileUrl, { credentials: 'include' });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const fn = filenameFromResponse(res) || sanitizeFilename(item.name) || `resource_${item.id}`;
  return [{ path: fn, blob }];
}

async function fetchFolder(item) {
  const u = new URL(item.url);
  const dlUrl = `${u.origin}/mod/folder/download_folder.php?id=${item.id}`;
  try {
    const res = await fetch(dlUrl, { credentials: 'include' });
    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    if (res.ok && (ct.includes('zip') || ct.includes('octet-stream'))) {
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
      out.push({ path: `${folder}/${fn}`, blob });
    } catch {}
  }
  if (!out.length) throw new Error('תיקייה ריקה / חסומה');
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
      out.push({ path: `${folder}/${fn}`, blob });
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
      out.push({ path: `${folder}/_הגשות שלי/${fn}`, blob });
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
  // Look at "Due date" / "תאריך אחרון להגשה" rows; modern Moodle uses .activity-dates
  const candidates = [];
  for (const el of doc.querySelectorAll('.activity-dates div, .activity-dates [data-region="activity-date"], table tr td, .description-inner div, .description-content div')) {
    const t = (el.textContent || '').trim();
    if (!t) continue;
    if (/תאריך\s+אחרון|מועד\s+אחרון|due\s+date|cut[-\s]?off|deadline/i.test(t)) candidates.push(t);
  }
  // Sibling cell pattern (table-based assignment summary)
  for (const td of doc.querySelectorAll('td')) {
    if (/תאריך\s+אחרון|מועד\s+אחרון|due\s+date|cut[-\s]?off/i.test(td.textContent || '')) {
      const next = td.nextElementSibling;
      if (next) candidates.push(next.textContent.trim());
    }
  }
  for (const c of candidates) {
    const d = parseDate(c);
    if (d) return d;
  }
  return null;
}

async function fetchUrlActivity(item) {
  // Step 1: hit mod/url/view.php with redirect=1 so Moodle follows its own
  // workaround and either delivers the file content directly or 302s us to
  // the external URL. We follow all redirects automatically.
  const moodleUrl = item.url + (item.url.includes('?') ? '&' : '?') + 'redirect=1';
  let res, finalUrl, ct, cd;
  try {
    res = await fetch(moodleUrl, { credentials: 'include', redirect: 'follow' });
    finalUrl = res.url || item.url;
    ct = (res.headers.get('Content-Type') || '').toLowerCase();
    cd = (res.headers.get('Content-Disposition') || '').toLowerCase();
  } catch {
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
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Step 2: extract the external URL
  let external = doc.querySelector('a.urlworkaround')?.href
              || doc.querySelector('.urlworkaround a')?.href
              || doc.querySelector('main a[href^="http"]:not([href*="moodlearn"])')?.href;
  if (!external) {
    const m = html.match(/url\s*=\s*['"](https?:[^'"]+)['"]/i)
           || html.match(/window\.location(?:\.href)?\s*=\s*['"](https?:[^'"]+)['"]/i)
           || html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"';]+)/i);
    if (m) external = m[1].trim();
  }
  // If we got redirected to a non-Moodle URL but never found an external link,
  // use the final URL as the external.
  if (!external && finalUrl && !finalUrl.includes('moodlearn')) external = finalUrl;
  if (!external) return [{ kind: 'link', type: 'url', name: item.name, url: item.url }];

  // Step 3: classify
  if (isStreamingUrl(external)) {
    return [{ kind: 'recording', type: 'recording', name: item.name, url: external }];
  }
  if (!isAllowedHost(external)) {
    return [{ kind: 'link', type: 'url', name: item.name, url: external }];
  }

  // Step 4: fetch the external URL. Be aggressive — if it's a file, save it;
  // if it's an HTML page that contains a direct download link to a PDF/Office
  // file, follow that one level deeper.
  try {
    const r = await fetch(external, { credentials: 'include', redirect: 'follow' });
    if (r.ok) {
      const rct = (r.headers.get('Content-Type') || '').toLowerCase();
      const rcd = (r.headers.get('Content-Disposition') || '').toLowerCase();
      const rFinalUrl = r.url || external;

      if (isFileResponse(rct, rcd, rFinalUrl)) {
        const blob = await r.blob();
        const fn = filenameFromResponse(r)
                || (sanitizeFilename(item.name) + (extFromCT(rct) || extFromUrl(rFinalUrl) || ''));
        return [{ path: fn, blob }];
      }

      // External page is HTML — look for an obvious "download this" link.
      const externalHtml = await r.text();
      const externalDoc = new DOMParser().parseFromString(externalHtml, 'text/html');
      const downloadCand = externalDoc.querySelector(
        'a[download], a[href*=".pdf" i], a[href*=".docx" i], a[href*=".pptx" i],'
        + ' a[href*="forcedownload" i], a[href*="getfile" i], a[href*="syllabus" i]'
      );
      if (downloadCand) {
        const downloadUrl = new URL(downloadCand.getAttribute('href'), rFinalUrl).href;
        if (isAllowedHost(downloadUrl)) {
          try {
            const dr = await fetch(downloadUrl, { credentials: 'include', redirect: 'follow' });
            if (dr.ok) {
              const dct = (dr.headers.get('Content-Type') || '').toLowerCase();
              const dcd = (dr.headers.get('Content-Disposition') || '').toLowerCase();
              if (isFileResponse(dct, dcd, dr.url || downloadUrl)) {
                const blob = await dr.blob();
                const fn = filenameFromResponse(dr)
                        || (sanitizeFilename(item.name) + (extFromCT(dct) || extFromUrl(downloadUrl) || ''));
                return [{ path: fn, blob }];
              }
            }
          } catch {}
        }
      }
    }
  } catch {}

  return [{ kind: 'link', type: 'url', name: item.name, url: external }];
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
      out.push({ path: `${folder}/${fn}`, blob });
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
    const start = formatICSDate(e.start);
    const end = formatICSDate(new Date(e.start.getTime() + 30 * 60 * 1000));
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${formatICSDate(new Date())}`);
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
function formatICSDate(d) {
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
  await chrome.downloads.download({
    url,
    filename: `zoom-recordings_${date}.txt`,
    saveAs: false,
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
      const tsAttr = scope.querySelector?.('[data-timestamp]');
      if (tsAttr?.dataset?.timestamp) {
        const v = +tsAttr.dataset.timestamp;
        if (!isNaN(v) && v > 0) return v * 1000;
      }
      const timeEl = scope.querySelector?.('time[datetime]');
      if (timeEl?.dateTime) {
        const t = new Date(timeEl.dateTime).getTime();
        if (!isNaN(t)) return t;
      }
      const text = scope.textContent || '';
      const dateM = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      const timeM = text.match(/(\d{1,2}):(\d{2})/);
      if (dateM) {
        const day = +dateM[1], month = +dateM[2] - 1, year = +dateM[3];
        const hour = timeM ? +timeM[1] : 23;
        const min  = timeM ? +timeM[2] : 59;
        const t = new Date(year, month, day, hour, min).getTime();
        if (!isNaN(t)) return t;
      }
      return null;
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
    setStatus('בחר לפחות מטלה אחת עם תאריך הגשה.');
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

  setStatus(`יוצאו ${selected.length} מטלות ל-ICS.`);
  notify('Moodle Hoarder', `${selected.length} מטלות נשמרו ליומן`);
});
