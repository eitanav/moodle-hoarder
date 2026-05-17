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
};

async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  // shallow merge top-level + deep merge for fileTypes
  const merged = { ...SETTINGS_DEFAULTS, ...(stored.settings || {}) };
  merged.fileTypes = { ...SETTINGS_DEFAULTS.fileTypes, ...((stored.settings || {}).fileTypes || {}) };
  return merged;
}

async function saveSettings(next) {
  await chrome.storage.local.set({ settings: next });
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
}
