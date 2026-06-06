// ===================== i18n =====================
// Shared translation module — loaded by popup.html and options.html. Holds
// the Hebrew/English string dictionary plus helpers for resolving the
// effective UI language and applying translations to the DOM.
//
// Language resolution (in order):
//   1. settings.uiLanguage = 'he' or 'en' → forced.
//   2. settings.uiLanguage = 'auto' → look at the user's active Moodle tab
//      <html lang> if available; fall back to navigator.language; default 'he'.
//
// Strings are keyed by stable identifiers. HTML files use [data-i18n="key"]
// (text content) and [data-i18n-attr="attr:key,attr:key"] (specific attrs).
// JS code calls t(key) directly.
//
// Coverage is intentionally partial: the buttons / section headers /
// language picker itself are translated, but most help text remains
// Hebrew (which is the primary user base — Ariel University students).
// Untranslated strings fall back to the Hebrew text in the HTML, which
// is the safe default.

const MH_STRINGS = {
  he: {
    // Header
    'app.title': 'Moodle Hoarder',
    'app.tagline': 'אוסף לך הכל מהמודל לתיק אחד',
    'app.settings.title': 'הגדרות',
    'options.header.title': 'Moodle Hoarder — הגדרות',
    'options.header.sub': 'כל הטוגלים והאופציות במקום אחד',

    // Common buttons
    'btn.scan': 'סרוק',
    'btn.back': 'חזור',
    'btn.download.zip': 'הורד ל-ZIP',
    'btn.download.all': 'הורד את כל הקורסים שנבחרו',
    'btn.select.all': 'הכל',
    'btn.select.none': 'ניקוי',
    'btn.select.defaults': 'איפוס',
    'btn.export.deadlines': 'ייצא ליומן',
    'btn.decode.zoom': 'פענח קישורים והורד',
    'btn.only.new': 'בחר רק חדשים',

    // Initial hint
    'initial.hint': 'פתח דף קורס במודל או דף "הקורסים שלי", ולחץ "סרוק".',

    // Picker labels
    'picker.search.placeholder': 'חיפוש...',
    'picker.selected.of': 'מתוך',
    'picker.selected.suffix': 'נבחרו',
    'picker.expand.all.title': 'פתח/סגור הכל',

    // Multi-course view
    'multi.found.prefix': 'נמצאו',
    'multi.found.suffix': 'קורסים בעמוד "הקורסים שלי".',
    'multi.search.placeholder': 'חיפוש קורס...',
    'multi.only.new': 'הורד רק קבצים חדשים בכל קורס',

    // Deadlines view
    'deadlines.found.prefix': 'נמצאו',
    'deadlines.found.suffix': 'מטלות (ללא המוסתרות).',
    'deadlines.help.ical': 'סמן אילו מטלות לכלול בקובץ היומן. אחרי ההורדה — לחיצה כפולה תוסיף אותן ליומן (Google Calendar, Outlook, Apple Calendar).',
    'deadlines.help.mycourses': '💡 כדי להוריד קבצי קורסים — עבור לדף "הקורסים שלי" ולחץ שוב על אייקון התוסף.',

    // Zoom view
    'zoom.found.prefix': 'נמצאו',
    'zoom.found.suffix': 'הקלטות. בחר אילו לפענח קישורים אליהן:',
    'zoom.search.placeholder': 'חיפוש בהקלטות...',
    'zoom.selected.suffix': 'נבחרו',

    // Options page section titles
    'opt.section.appearance': 'מראה',
    'opt.section.zip': 'מבנה ה-ZIP',
    'opt.section.download': 'הורדה',
    'opt.section.content': 'תוכן',
    'opt.section.rightclick': 'קליק ימני',
    'opt.section.history': 'היסטוריה',
    'opt.section.reset': 'איפוס',
    'opt.section.language': 'שפת ממשק',

    // Language picker
    'opt.lang.title': 'שפת ממשק',
    'opt.lang.hint': '"אוטומטי" יקבע את השפה לפי הקורס הפתוח כעת ב-Moodle (לפי תג ה-<code>&lt;html lang&gt;</code>). אחרת — בחירה ידנית.',
    'opt.lang.auto': 'אוטומטי',
    'opt.lang.he': 'עברית',
    'opt.lang.en': 'English',

    // Common status messages
    'status.saved': 'נשמר',
    'status.scanning': 'סורק...',
    'status.downloading': 'מוריד...',
    'status.zipping': 'יוצר ZIP...',
    'status.done': 'הושלם',
    'status.error': 'שגיאה',

    // Dynamic status (popup.js setStatus + logLine)
    'status.opening.activities': 'פותח את כל הפעילויות...',
    'status.scanning.deadlines': 'סורק דדליינים...',
    'status.no.deadlines': 'לא נמצאו מטלות. ודא שטעון "ממתין לביצוע" ונסה שוב.',
    'status.error.with.message': 'שגיאה: {msg}',
    'status.downloading.queue': 'מוריד {n} פריטים בתור...',
    'status.queue.failed': 'כשל בהורדת התור.',
    'status.zipping.bundle': 'מארז ZIP...',
    'status.completed.with.count': 'הושלם: {n} פריטים, {size}.',
    'status.checking.page': 'בודק עמוד...',
    'status.waiting.zoom': 'ממתין שדף ה-Zoom ייטען...',
    'status.no.zoom': 'לא נמצאו הקלטות. ראה את הקובץ שירד לפרטים.',
    'status.scanning.courses': 'סורק קורסים...',
    'status.no.courses': 'לא נמצאו קורסים. גלול מטה כדי שכל הקורסים יטענו ונסה שוב.',
    'status.scanning.course': 'סורק קורס...',
    'status.no.items': 'לא נמצאו פריטים בדף.',
    'status.wrong.page': 'יש לעבור לדף קורס במודל אריאל או לדף "הקורסים שלי".',
    'status.zoom.start': 'מתחיל פענוח קישורים ל-{n} הקלטות — אל תסגור!',
    'status.zoom.no.urls': 'לא נמצאו URLs. הורד גם zoom-detail-debug HTML.',
    'status.zoom.results': 'הושלם: {ok}/{total} קישורים נמצאו.',
    'status.completed': 'הושלם.',
    'status.downloading.parallel': 'מוריד {n} פריטים במקביל (עד {c} בו-זמנית)...',
    'status.no.deadlines.selected': 'בחר לפחות מטלה אחת עם תאריך הגשה.',
    'status.exported.deadlines': 'יוצאו {n} מטלות ל-ICS.',
    'log.nothing.to.download': '— {name}: אין מה להוריד',
    'log.course.items': '✓ {name}: {n} פריטים',
    'log.grades.failed': '✗ שליפת ציונים: {msg}',
    'err.no.active.tab': 'אין טאב פעיל',
    'err.file.not.found': 'לא נמצא קובץ',
    'err.folder.empty': 'תיקייה ריקה / חסומה',

    // Confirm dialogs, notifications, diff banners
    'queue.clear.confirm': 'לרוקן את התור?',
    'notif.queue.done': '{n} פריטים מהתור הורדו',
    'notif.multi.done': 'הסתיימה הורדת {n} קורסים',
    'notif.course.done': 'הורדו {n} פריטים מ-"{name}"',
    'size.over.tooltip': 'מעל {mb}MB — סומן אדום ובוטלה בחירה. אפשר לסמן ידנית בכל זאת.',
    'size.checking': 'בודק גדלי קבצים…',
    'size.checking.progress': 'בודק גדלי קבצים… {done}/{total}',
    'size.summary.over': '{n} קבצים מעל {mb}MB סומנו באדום וביטלתי את הבחירה — אפשר לסמן ידנית.',
    'diff.checkpoint': 'נמצאה הורדה לא-גמורה מ-{date} ({n} פריטים כבר ירדו). הם יישמרו וההורדה תמשיך משם.',
    'diff.previous': 'נמצאה הורדה קודמת מתאריך {date} — {n} פריטים חדשים מאז.',
    'diff.chip.new': 'חדש',
    'diff.chip.notdefault': 'לא בדיפולט',
    'multi.pin.title': 'בטל הצמדה',
    'multi.unpin.title': 'הצמד למעלה',

    // content_dashboard.js — buttons injected into the Moodle dashboard
    'dash.hide': 'הסתר',
    'dash.hide.title': 'הסתר מטלה זו (Moodle Hoarder)',
    'dash.unhide': 'החזר',
    'dash.unhide.title': 'החזר מטלה זו לרשימה',
    'dash.clear.all': 'בטל הכל',
    'dash.clear.all.title': 'החזר את כל המטלות המוסתרות לרשימה',
    'dash.clear.all.confirm': 'להחזיר את כל {n} המטלות המוסתרות לרשימה?',
    'dash.count.hidden': '{n} מטלות מוסתרות',
    'dash.show.hidden': 'הצג מוסתרות',
    'dash.hide.again': 'הסתר שוב',
  },
  en: {
    'app.title': 'Moodle Hoarder',
    'app.tagline': 'Hoards everything from Moodle into one ZIP',
    'app.settings.title': 'Settings',
    'options.header.title': 'Moodle Hoarder — Settings',
    'options.header.sub': 'All the toggles and options in one place',

    'btn.scan': 'Scan',
    'btn.back': 'Back',
    'btn.download.zip': 'Download ZIP',
    'btn.download.all': 'Download all selected courses',
    'btn.select.all': 'All',
    'btn.select.none': 'None',
    'btn.select.defaults': 'Reset',
    'btn.export.deadlines': 'Export to calendar',
    'btn.decode.zoom': 'Decode links & download',
    'btn.only.new': 'Only new',

    'initial.hint': 'Open a Moodle course page (course/view.php) or your courses page (my/courses.php) and click "Scan".',

    'picker.search.placeholder': 'Search...',
    'picker.selected.of': 'of',
    'picker.selected.suffix': 'selected',
    'picker.expand.all.title': 'Expand/collapse all',

    'multi.found.prefix': 'Found',
    'multi.found.suffix': 'courses in "My courses" page.',
    'multi.search.placeholder': 'Search course...',
    'multi.only.new': 'Download only new files per course',

    'deadlines.found.prefix': 'Found',
    'deadlines.found.suffix': 'assignments (excluding hidden).',
    'deadlines.help.ical': 'Pick which assignments to include in the calendar file. After download — double-click to add them to Google Calendar / Outlook / Apple Calendar.',
    'deadlines.help.mycourses': '💡 To download course files — go to the "My courses" page and click the extension icon again.',

    'zoom.found.prefix': 'Found',
    'zoom.found.suffix': 'recordings. Pick which to resolve URLs for:',
    'zoom.search.placeholder': 'Search recordings...',
    'zoom.selected.suffix': 'selected',

    'opt.section.appearance': 'Appearance',
    'opt.section.zip': 'ZIP structure',
    'opt.section.download': 'Download',
    'opt.section.content': 'Content',
    'opt.section.rightclick': 'Right-click',
    'opt.section.history': 'History',
    'opt.section.reset': 'Reset',
    'opt.section.language': 'Interface language',

    'opt.lang.title': 'Interface language',
    'opt.lang.hint': '"Auto" picks the language based on the open Moodle course (using the <code>&lt;html lang&gt;</code> tag). Otherwise — manual.',
    'opt.lang.auto': 'Auto',
    'opt.lang.he': 'עברית',
    'opt.lang.en': 'English',

    'status.saved': 'Saved',
    'status.scanning': 'Scanning...',
    'status.downloading': 'Downloading...',
    'status.zipping': 'Building ZIP...',
    'status.done': 'Done',
    'status.error': 'Error',

    'status.opening.activities': 'Opening all activities...',
    'status.scanning.deadlines': 'Scanning deadlines...',
    'status.no.deadlines': 'No assignments found. Make sure "Timeline" is loaded and try again.',
    'status.error.with.message': 'Error: {msg}',
    'status.downloading.queue': 'Downloading {n} queued items...',
    'status.queue.failed': 'Queue download failed.',
    'status.zipping.bundle': 'Packaging ZIP...',
    'status.completed.with.count': 'Done: {n} items, {size}.',
    'status.checking.page': 'Checking page...',
    'status.waiting.zoom': 'Waiting for the Zoom page to load...',
    'status.no.zoom': 'No recordings found. See the downloaded file for details.',
    'status.scanning.courses': 'Scanning courses...',
    'status.no.courses': 'No courses found. Scroll down so all courses load, then retry.',
    'status.scanning.course': 'Scanning course...',
    'status.no.items': 'No items found on the page.',
    'status.wrong.page': 'Please open a Moodle course page or the "My courses" page.',
    'status.zoom.start': 'Resolving URLs for {n} recordings — do not close!',
    'status.zoom.no.urls': 'No URLs found. Download the zoom-detail-debug HTML too.',
    'status.zoom.results': 'Done: {ok}/{total} URLs resolved.',
    'status.completed': 'Done.',
    'status.downloading.parallel': 'Downloading {n} items in parallel (up to {c} at a time)...',
    'status.no.deadlines.selected': 'Pick at least one assignment with a due date.',
    'status.exported.deadlines': 'Exported {n} assignments to ICS.',
    'log.nothing.to.download': '— {name}: nothing to download',
    'log.course.items': '✓ {name}: {n} items',
    'log.grades.failed': '✗ Grades fetch: {msg}',
    'err.no.active.tab': 'No active tab',
    'err.file.not.found': 'No file found',
    'err.folder.empty': 'Empty / blocked folder',

    'queue.clear.confirm': 'Empty the queue?',
    'notif.queue.done': '{n} queued items downloaded',
    'notif.multi.done': 'Finished downloading {n} courses',
    'notif.course.done': 'Downloaded {n} items from "{name}"',
    'size.over.tooltip': 'Over {mb}MB — marked red and unchecked. You can still check it manually.',
    'size.checking': 'Checking file sizes…',
    'size.checking.progress': 'Checking file sizes… {done}/{total}',
    'size.summary.over': '{n} files over {mb}MB were marked red and unchecked — you can re-check manually.',
    'diff.checkpoint': 'Incomplete download from {date} found ({n} items already saved). They will be kept and the download will resume.',
    'diff.previous': 'Previous download from {date} — {n} new items since.',
    'diff.chip.new': 'new',
    'diff.chip.notdefault': 'non-default',
    'multi.pin.title': 'Unpin',
    'multi.unpin.title': 'Pin to top',

    'dash.hide': 'Hide',
    'dash.hide.title': 'Hide this assignment (Moodle Hoarder)',
    'dash.unhide': 'Restore',
    'dash.unhide.title': 'Restore this assignment to the list',
    'dash.clear.all': 'Clear all',
    'dash.clear.all.title': 'Restore all hidden assignments to the list',
    'dash.clear.all.confirm': 'Restore all {n} hidden assignments?',
    'dash.count.hidden': '{n} assignments hidden',
    'dash.show.hidden': 'Show hidden',
    'dash.hide.again': 'Hide again',
  },
};

// LocalStorage mirror so the inline theme-bootstrap (and any pre-paint
// language application) can read the resolved language synchronously.
const MH_LANG_LS_KEY = 'mh-lang';

// Currently active language. Defaults to Hebrew (matches the static HTML).
let MH_CURRENT_LANG = 'he';

// Detect a sensible "auto" language. Order:
//   1. <html lang> of the active Moodle tab, if reachable (caller can pass it).
//   2. navigator.language prefix.
//   3. 'he' as the safe default for this extension's user base.
function detectAutoLanguage(courseLang) {
  if (courseLang && typeof courseLang === 'string') {
    const lc = courseLang.toLowerCase();
    if (lc.startsWith('he') || lc.startsWith('iw')) return 'he';
    if (lc.startsWith('en')) return 'en';
  }
  try {
    const nav = (navigator.language || '').toLowerCase();
    if (nav.startsWith('he') || nav.startsWith('iw')) return 'he';
    if (nav.startsWith('en')) return 'en';
  } catch {}
  return 'he';
}

// Resolves the effective language given the user's setting and (optional)
// course language hint. Caller is responsible for fetching the course lang
// from the active tab if it wants 'auto' to be tab-aware.
function resolveLanguage(uiLanguageSetting, courseLang) {
  if (uiLanguageSetting === 'he' || uiLanguageSetting === 'en') return uiLanguageSetting;
  return detectAutoLanguage(courseLang);
}

// Translate a key with optional `{var}` substitution.
//   t('foo')                  → 'Hello'
//   t('foo', { n: 5 })        → 'Hello 5' (when 'foo' = 'Hello {n}')
// Falls back to English then to the key itself.
function t(key, vars) {
  const lang = MH_CURRENT_LANG;
  let str = (MH_STRINGS[lang] && MH_STRINGS[lang][key])
        || (MH_STRINGS.en && MH_STRINGS.en[key])
        || key;
  if (vars && typeof str === 'string') {
    str = str.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] : m));
  }
  return str;
}

// Apply the language to <html lang>, <html dir>, and all elements with
// data-i18n / data-i18n-attr attributes. Idempotent; safe to call again
// when the language setting changes.
function applyLanguage(lang) {
  MH_CURRENT_LANG = lang || 'he';
  try { localStorage.setItem(MH_LANG_LS_KEY, MH_CURRENT_LANG); } catch {}
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('lang', MH_CURRENT_LANG);
  root.setAttribute('dir', MH_CURRENT_LANG === 'he' ? 'rtl' : 'ltr');

  // Text content. If a node has children other than plain text, we'd
  // wipe them — so guard against that by only touching nodes whose
  // textContent equals the concatenation of their immediate text.
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const str = t(key);
    // Allow markup-bearing values via data-i18n-html="1"
    if (el.dataset.i18nHtml === '1') {
      el.innerHTML = str;
    } else {
      el.textContent = str;
    }
  });
  // Attribute bindings: "attr:key, attr:key"
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const spec = el.getAttribute('data-i18n-attr');
    if (!spec) return;
    for (const pair of spec.split(',')) {
      const [attr, key] = pair.split(':').map(s => s.trim());
      if (!attr || !key) continue;
      el.setAttribute(attr, t(key));
    }
  });
}

// Expose to whichever context loaded us.
if (typeof self !== 'undefined') {
  self.MH_STRINGS = MH_STRINGS;
  self.t = t;
  self.applyLanguage = applyLanguage;
  self.resolveLanguage = resolveLanguage;
  self.detectAutoLanguage = detectAutoLanguage;
  self.MH_LANG_LS_KEY = MH_LANG_LS_KEY;
}
