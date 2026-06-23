// ===================== update checker =====================
// Moodle Hoarder is installed "unpacked" from GitHub, so Chrome never
// auto-updates it. This module polls the repo's manifest.json on `main`,
// compares the version to the running one, and lets the UI surface an
// "update available" banner.
//
// Privacy: this is a plain GET of a public file on raw.githubusercontent.com.
// No user data, cookies, or course content is ever sent. Gated by the
// settings.checkUpdates toggle (the caller checks it for the automatic poll;
// an explicit "Check now" button forces a fetch regardless).
//
// Loaded by popup.html and options.html (after settings.js / i18n.js).

const MH_UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/eitanav/moodle-hoarder/main/manifest.json';
const MH_REPO_URL = 'https://github.com/eitanav/moodle-hoarder';
const MH_CHANGELOG_URL = 'https://github.com/eitanav/moodle-hoarder/blob/main/CHANGELOG.md';

// Optional "Buy Me a Coffee" (or any donation) link. Leave empty to hide the
// donate button entirely. To enable: create a page at buymeacoffee.com, then
// paste your URL here, e.g. 'https://www.buymeacoffee.com/yourhandle'.
const MH_DONATE_URL = '';
const MH_UPDATE_CHECK_KEY = 'updateCheck';
const MH_UPDATE_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 hours

function mhParseVersion(v) {
  return String(v == null ? '0' : v).split('.').map(n => parseInt(n, 10) || 0);
}

// Returns 1 if a > b, -1 if a < b, 0 if equal (numeric, dotted versions).
function mhCompareVersions(a, b) {
  const pa = mhParseVersion(a), pb = mhParseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function mhCurrentVersion() {
  try { return chrome.runtime.getManifest().version; } catch { return '0'; }
}

// Check GitHub for a newer version. Throttled to MH_UPDATE_THROTTLE_MS unless
// force=true. Caches the result in chrome.storage.local. Never throws —
// network failures resolve to a result based on the last known value.
async function mhCheckForUpdate(force = false) {
  const current = mhCurrentVersion();
  let cache = {};
  try { cache = (await chrome.storage.local.get(MH_UPDATE_CHECK_KEY))[MH_UPDATE_CHECK_KEY] || {}; } catch {}

  const fresh = cache.lastCheckedAt && (Date.now() - cache.lastCheckedAt) < MH_UPDATE_THROTTLE_MS;
  if (!force && fresh && cache.latestVersion) {
    return {
      current,
      latest: cache.latestVersion,
      hasUpdate: mhCompareVersions(cache.latestVersion, current) > 0,
      cached: true,
    };
  }

  try {
    const res = await fetch(MH_UPDATE_MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const latest = data.version || current;
    try {
      await chrome.storage.local.set({
        [MH_UPDATE_CHECK_KEY]: { ...cache, lastCheckedAt: Date.now(), latestVersion: latest },
      });
    } catch {}
    return { current, latest, hasUpdate: mhCompareVersions(latest, current) > 0 };
  } catch (e) {
    return {
      current,
      latest: cache.latestVersion || current,
      hasUpdate: cache.latestVersion ? mhCompareVersions(cache.latestVersion, current) > 0 : false,
      error: String((e && e.message) || e),
    };
  }
}

// Reload the extension. For an unpacked extension this re-reads the files from
// disk — so AFTER update.bat (git pull) has refreshed the files, this single
// click picks up the new version without visiting chrome://extensions. It does
// NOT pull code itself (an extension can't run git / overwrite its own files);
// update.bat still does the download step.
function mhReloadExtension() {
  try { chrome.runtime.reload(); } catch {}
}

// Open the extension's own card in chrome://extensions so the user can hit the
// Reload icon after running update.bat. Opening chrome:// pages from a tab is
// allowed for chrome://extensions.
function mhOpenExtensionsPage() {
  const card = (() => { try { return `chrome://extensions/?id=${chrome.runtime.id}`; } catch { return 'chrome://extensions'; } })();
  try {
    chrome.tabs.create({ url: card });
  } catch {
    try { chrome.tabs.create({ url: 'chrome://extensions' }); } catch {}
  }
}

if (typeof self !== 'undefined') {
  self.mhCheckForUpdate = mhCheckForUpdate;
  self.mhCompareVersions = mhCompareVersions;
  self.mhCurrentVersion = mhCurrentVersion;
  self.mhReloadExtension = mhReloadExtension;
  self.mhOpenExtensionsPage = mhOpenExtensionsPage;
  self.MH_UPDATE_MANIFEST_URL = MH_UPDATE_MANIFEST_URL;
  self.MH_REPO_URL = MH_REPO_URL;
  self.MH_CHANGELOG_URL = MH_CHANGELOG_URL;
  self.MH_DONATE_URL = MH_DONATE_URL;
}
