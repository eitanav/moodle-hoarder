// Shared settings module — used by popup.html, options.html, and background.js.
// Settings live in chrome.storage.local under the key "settings"; getSettings()
// always returns DEFAULTS merged with whatever is stored, so callers never
// have to handle "missing key".

const SETTINGS_DEFAULTS = {
  // Layout of the produced ZIP. 'sections' = only the numbered section folders,
  // 'flat' = only the single "00 - כל הקבצים" folder, 'both' = both views (default).
  zipLayout: 'both',

  // When true, every download asks where to save (chrome.downloads saveAs flag).
  saveAs: false,

  // Optional sub-path under the user's default Downloads directory.
  // Empty string => save straight to Downloads. Chrome doesn't allow absolute
  // paths from extensions, but a relative path like "Moodle/2026-spring/" is fine.
  downloadSubfolder: '',

  // When true, scrape grader/report.php for this course and add ציונים.csv to the ZIP.
  includeGrades: false,

  // Activity types to allow into the ZIP by default. Users can still override
  // per-course in the picker; this controls the default-checked state.
  fileTypes: {
    resource: true,
    folder:   true,
    assign:   true,
    url:      true,
    page:     true,
    book:     true,
    quiz:     true,
    lesson:   true,
    forum:    false,
    chat:     false,
    feedback: false,
    choice:   false,
    wiki:     false,
    glossary: false,
    workshop: false,
    scorm:    true,
    h5pactivity: true,
  },

  // Context menu (right-click on a Moodle link) behavior:
  //   'immediate' = download right away as a single file (current behavior).
  //   'queue'     = add to an in-memory queue; pop a "Download queue" button
  //                 in the popup, click to ZIP everything together.
  //   'ask'       = open a small chooser before each download.
  rightClickBehavior: 'immediate',

  // If true, the context-menu download opens Chrome's "Save As" dialog.
  rightClickSaveAs: false,

  // UI theme. 'auto' = follow system (prefers-color-scheme),
  // 'light' or 'dark' = force.
  theme: 'auto',

  // Accent palette. 'orange-pink' = default brand colors,
  // 'blue-ariel' = Ariel University blue.
  accentColor: 'orange-pink',

  // Compact mode — single-line item rows in pickers. Useful when a course
  // has many items and the popup needs to fit more on screen.
  compactMode: false,

  // Max file size warning (MB). 0 = disabled. When > 0, the popup warns
  // before including files larger than this in the ZIP. The user can
  // still opt in; we just unselect them by default in the picker.
  maxFileSizeMB: 0,

  // UI language (ROADMAP #16). 'auto' = follow the open Moodle course's
  // <html lang> (falls back to navigator.language and finally Hebrew).
  // 'he' or 'en' = force.
  uiLanguage: 'auto',

  // Include course.json in the ZIP (ROADMAP #72). A structured dump of
  // the course (sections, items, types, URLs, sizes) — opens easy
  // integration with Notion / Anki / Sheets / scripts. Defaults to true:
  // it's small, useful, and doesn't leak anything the ZIP doesn't already.
  includeJson: true,

  // Extract Zoom auto-transcripts (WebVTT) for each selected recording.
  // When true, after the share URL extraction the extension opens each
  // recording in a hidden background tab, intercepts the VTT XHR, and
  // bundles transcripts (both raw .vtt and cleaned .txt) into the output
  // ZIP. Parallelized 3-at-a-time (see transcriptConcurrency).
  extractTranscripts: true,

  // Which transcript file formats to include in the ZIP.
  // 'txt'  = only the cleaned reading text (default — VTT is a subtitle
  //          format meant for video players, not for reading; the
  //          cleaned TXT we produce is easier to skim, search, and feed
  //          into other tools)
  // 'both' = both .vtt (raw with timestamps) and .txt (clean reading text)
  // 'vtt'  = only the WebVTT file (subtitles for the recording)
  transcriptFormats: 'txt',

  // How many transcripts to extract simultaneously. Each one opens a
  // background tab that runs Zoom's player + auth, so going much higher
  // than ~3 starts to thrash memory and risk Zoom rate-limits.
  transcriptConcurrency: 3,
};

// Theme persists to localStorage too so the popup/options HTML can apply
// the right class synchronously from an inline <script>, avoiding the
// flash of wrong theme on page open.
const THEME_LS_KEY = 'mh-theme';
const ACCENT_LS_KEY = 'mh-accent';

async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  // shallow merge top-level + deep merge for fileTypes
  const merged = { ...SETTINGS_DEFAULTS, ...(stored.settings || {}) };
  merged.fileTypes = { ...SETTINGS_DEFAULTS.fileTypes, ...((stored.settings || {}).fileTypes || {}) };
  return merged;
}

async function saveSettings(next) {
  await chrome.storage.local.set({ settings: next });
  // Mirror theme and accent to localStorage so the next popup/options page
  // open can apply them synchronously before paint.
  try {
    if (typeof localStorage !== 'undefined' && next) {
      if (next.theme) localStorage.setItem(THEME_LS_KEY, next.theme);
      if (next.accentColor) localStorage.setItem(ACCENT_LS_KEY, next.accentColor);
    }
  } catch {}
}

// Apply the current theme to the document root (used by popup.js / options.js).
function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('mh-theme-light', 'mh-theme-dark');
  if (theme === 'light') root.classList.add('mh-theme-light');
  else if (theme === 'dark') root.classList.add('mh-theme-dark');
  // 'auto' or unrecognised → no class, CSS media query handles it.
  try { localStorage.setItem(THEME_LS_KEY, theme || 'auto'); } catch {}
}

// Apply the accent palette (orange-pink default, or blue-ariel).
function applyAccent(color) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('mh-accent-blue');
  if (color === 'blue-ariel') root.classList.add('mh-accent-blue');
  try { localStorage.setItem(ACCENT_LS_KEY, color || 'orange-pink'); } catch {}
}

async function updateSetting(key, value) {
  const s = await getSettings();
  s[key] = value;
  await saveSettings(s);
  return s;
}

async function resetSettings() {
  await chrome.storage.local.remove('settings');
  return { ...SETTINGS_DEFAULTS };
}

// Expose to whichever context loaded us.
if (typeof self !== 'undefined') {
  self.SETTINGS_DEFAULTS = SETTINGS_DEFAULTS;
  self.getSettings = getSettings;
  self.saveSettings = saveSettings;
  self.updateSetting = updateSetting;
  self.resetSettings = resetSettings;
  self.applyTheme = applyTheme;
  self.applyAccent = applyAccent;
}
