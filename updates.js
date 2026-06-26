// ===================== integrations config =====================
// Store build: updates are handled automatically by the Chrome Web Store, so
// the GitHub update-checker and native-host updater are not included here.
// This file only holds the optional donation + feedback configuration used by
// the options page.

// Optional donation link (Ko-fi). Leave empty to hide the donate button.
const MH_DONATE_URL = 'https://ko-fi.com/moodlehoarder';

// Web3Forms access key for the in-extension feedback form. The key is an
// anonymous UUID; the owner's email never appears in this code (it lives on
// Web3Forms' side). Leave empty to fall back to the GitHub Issues link.
const MH_FEEDBACK_KEY = '5c375fcc-f783-40eb-a951-9f48741568ba';
const MH_FEEDBACK_ENDPOINT = 'https://api.web3forms.com/submit';
const MH_ISSUES_URL = 'https://github.com/eitanav/moodle-hoarder/issues';

if (typeof self !== 'undefined') {
  self.MH_DONATE_URL = MH_DONATE_URL;
  self.MH_FEEDBACK_KEY = MH_FEEDBACK_KEY;
  self.MH_FEEDBACK_ENDPOINT = MH_FEEDBACK_ENDPOINT;
  self.MH_ISSUES_URL = MH_ISSUES_URL;
}
