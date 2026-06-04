# 🔄 הנדאוף לצ'אט חדש — Moodle Hoarder

> **קרא אותי קודם.** המסמך הזה נותן לצ'אט חדש את כל ההקשר הדרוש בלי לקרוא את כל ההיסטוריה. אחרי שתקרא — הצץ ב-`CHANGELOG.md` (5 ערכים אחרונים) אם צריך פרטים.

## מה זה הפרויקט
תוסף Chrome (MV3) שאוסף חומר מקורסים במודל אריאל (`moodlearn.ariel.ac.il`) ל-ZIP: קבצים, תיקיות, מטלות, סילבוס, ותמלילי+וידאו של הקלטות Zoom.
- רפו: https://github.com/eitanav/moodle-hoarder — **תמיד דוחפים ל-`main`** (גם ל-`claude/keen-volta-9pwtR`).
- המשתמש טוען מתיקייה מקומית: `C:\Users\USER\Documents\Extensions\moodle-hoarder`. יש `update.bat` (דאבל-קליק → `git reset --hard origin/main`) ואז Reload ב-`chrome://extensions`. **רק כשמוסיפים הרשאה ב-manifest צריך Remove + Load unpacked** (לא רק Reload).

## ✅ מצב נוכחי (v1.32.5) — הורדת וידאו Zoom **עובדת**
אחרי מסע ארוך, הורדת הקלטות הענן (VOD) עובדת. **אל תשבור את זה.**

### המנגנון של Zoom (הקלטות ענן, לא פגישות חיות)
1. הנגן קורא ל-`/nws/common/2.0/nak` → מקבל **JWT bearer token**.
2. קורא ל-`/nws/recording/1.0/play/info/<token>` עם `Authorization: Bearer <JWT>` → JSON עם **`viewMp4Url`** = MP4 חתום (CloudFront: `data`+`s001`+`s002`+`fid`+`tid`+`Policy`+`Signature`+`Key-Pair-Id`).
3. ה-`<video>` מושך מ-`ssrweb.zoom.us` → MP4 ישיר. **אין HLS, אין DRM, אין MSE.**

### איך ההורדה עובדת אצלנו (popup → SW → offscreen)
- **popup** (`$('downloadZoomVideos')` ב-popup.js): מפענח share URLs (`zoomEnsureResolved`), ולכל הקלטה שולח `chrome.runtime.sendMessage({type:'mh-download-rec', playUrl, filename, quality})`.
- **background.js** (`_mhDownloadOne`, תור סדרתי): פותח טאב נסתר → תופס את ה-signed URL (`_mhCaptureSignedUrl`) → סוגר טאב → מתקין כלל **DNR Referer** (`_mhSetRefererRule`, דומיין החשבון) → **offscreen** עושה `fetch` (הקשר תוסף = עוקף CORS) → blob → `chrome.downloads.download(blobUrl)` → מעקב סיום → revoke.
- **offscreen.html/js**: ה-fetch קורה כאן כי offscreen = origin של התוסף, ו-host_permissions עוקפות CORS (בדף web רגיל CORS חוסם).

### למה כל חלק קיים (לקחים — אל תחזור על המסע!)
- ❌ `chrome.downloads.download(signedUrl)` ישירות → **משבש את ה-URL החתום** → HTML 403 → קובץ `.htm` מבוטל. לכן מורידים `blob:` URL נקי, לא את ה-URL החתום.
- ❌ fetch **בתוך דף ה-Zoom** → כפוף ל-CORS → נחסם. לכן offscreen (הקשר תוסף).
- ✅ **חלק מההקלטות** (replay03) דורשות `Referer: https://<account>.zoom.us/`; אחרות (replay04) לא. לכן כלל ה-DNR מוסיף Referer (fetch לא יכול לקבוע Referer חוצה-origin לבד; DNR **כן** חל על fetch של offscreen, בניגוד ל-chrome.downloads).
- ה-URL החתום מאשר את עצמו (signature). היה באג חיתוך URL ל-600 תווים שמחק את החתימה — תוקן (cap 4000).

### דיבאג (אם משהו נשבר)
- ה-SW מדפיס `[MH] step1/2/3/4 …` ל-Console (chrome://extensions → "service worker" → Console, צריך Developer mode). מראה בדיוק איפה נעצר.
- כפתורי 🩺 דיאגנוסטיקה ו-🔬 מחקר עמוק בפיקר Zoom — מייצרים JSON מלא.

## 🔜 משימות פתוחות (לא דחופות)
1. **בורר איכות 'שאל אותי'** — כרגע מתנהג כמו 'הטובה ביותר'. ה-modal (`#qualityOverlay` ב-popup.html) שמור; צריך לחבר אותו לנתיב ה-SW (לאסוף רזולוציות → לשאול → להוריד).
2. **תת-תיקייה** — לא נתמכת בנתיב הנוכחי.
3. **קבצי ענק (1.58GB)** — כרגע blob שלם בזיכרון (Chrome מגלגל לדיסק, שביר). שדרוג: streaming (File System Access API / StreamSaver).
4. **ניקוי לפרודקשן** — להסיר/לגדר את לוגי ה-`[MH]` מאחורי דגל debug. אולי להסתיר את 🩺/🔬 מאחורי toggle בהגדרות.
5. **2.0?** — הורדת וידאו אמיתית היא headline feature. אם המשתמש רוצה, שווה לקפוץ ל-2.0 עם README מעודכן.

## כללי זהב
1. **אל תיגע ב-Zoom resolver** (`resolveZoomPlayUrls`, `waitForDetailPage`, `clickPlayAndCaptureUrl` ב-popup.js) — שביר, monkey-patch על window.open.
2. **debug-driven**: כשמשהו לא ידוע — בנה לוג/capture, בקש מהמשתמש להריץ, אל תנחש. זה מה שפיצח את כל הסאגה.
3. **CHANGELOG.md לכל גרסה** — "הבעיה / התיקון / איך לבחון", בעברית.
4. **bidi בעברית**: `replace(/[‎‏‪-‮⁦-⁩﻿]/g, '')` לפני regex match.
5. **שמות קבצים**: תמיד `sanitizeFilename()`.
6. **אל תכריז על ניצחון לפני שהמשתמש אישר.** (לקח כואב מהסאגה.)
7. **המשתמש לא תמיד בודק** — עבוד אוטונומית על מה שבטוח, אבל הורדת וידאו דורשת אימות שלו.

## מבנה קבצים
| קובץ | תפקיד |
|------|--------|
| `popup.js` (~4700 שורות) | כל לוגיקת ה-UI: scan, ZIP, ICS, Zoom transcripts, handler של 🎥/🩺/🔬 |
| `background.js` | service worker: context menu, **הורדת וידאו Zoom** (`mh-download-rec`), 🔬 deep research, DNR referer |
| `offscreen.html` + `offscreen.js` | fetch של ה-MP4 בהקשר תוסף (עוקף CORS) → blob |
| `popup.html` | תצוגות הפופאפ + modal בורר איכות |
| `options.html` + `options.js` + `settings.js` | הגדרות |
| `i18n.js` | he/en |
| `content_dashboard.js` | הסתרת מטלות ב-/my/ |
| `zip.js` | ZIP writer |
| `update.bat` | סנכרון מקומי ל-origin/main |

## להתחיל מהר
1. הכל ב-`main` ב-GitHub, נקי. אין צורך ב-pull בענן (clone טרי).
2. הורדת הווידאו **עובדת** — אל תיגע בלי סיבה.
3. אם המשתמש מבקש פיצ'ר חדש → התחל מהמשימות הפתוחות למעלה.
