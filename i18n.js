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
    'initial.hint': 'פתח דף קורס במודל (course/view.php) או דף הקורסים שלי (my/courses.php) ולחץ "סרוק".',

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
    'deadlines.help.ical': 'סמן אילו מטלות לכלול בקובץ היומן. אחרי ההורדה — לחיצה כפולה תוסיף אותן ל-Google Calendar / Outlook / Apple Calendar.',
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

// Translate a key. Falls back to English then to the key itself.
function t(key) {
  const lang = MH_CURRENT_LANG;
  return (MH_STRINGS[lang] && MH_STRINGS[lang][key])
      || (MH_STRINGS.en && MH_STRINGS.en[key])
      || key;
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
