# 🔄 הנדאוף לצ'אט חדש — Moodle Hoarder

> **קרא אותי קודם.** המסמך הזה נותן לצ'אט חדש את כל ההקשר הדרוש בלי לקרוא את כל ההיסטוריה. אחרי שתקרא — הצץ ב-`CHANGELOG.md` (5 ערכים אחרונים) אם צריך פרטים.

## מה זה הפרויקט
תוסף Chrome (MV3) שאוסף חומר מקורסים במודל אריאל (`moodlearn.ariel.ac.il`) ל-ZIP: קבצים, תיקיות, מטלות, סילבוס, ותמלילי+וידאו של הקלטות Zoom.
- רפו: https://github.com/eitanav/moodle-hoarder — **תמיד דוחפים ל-`main`** (גם ל-`claude/keen-volta-9pwtR`).
- המשתמש טוען מתיקייה מקומית: `C:\Users\USER\Documents\Extensions\moodle-hoarder`. יש `update.bat` (דאבל-קליק → `git reset --hard origin/main`) ואז Reload ב-`chrome://extensions`. **רק כשמוסיפים הרשאה ב-manifest צריך Remove + Load unpacked** (לא רק Reload).

## ✅ מצב נוכחי (v1.34.0) — הורדת וידאו Zoom **עובדת** + פולישים ל-V2
אחרי מסע ארוך, הורדת הקלטות הענן (VOD) עובדת (אושר ע"י המשתמש ב-v1.32.5). **אל תשבור את זה.**
מאז (v1.33–v1.34) נוספו פולישים לקראת שחרור V2: progress להורדת סרטונים, היסטוריית הורדות אמיתית, ניקוי ה-debug UI, והסרת בורר האיכויות + ממיר ה-VTT הידני. ראה סקציית **🚀 גרסה 2** ב-`ROADMAP-100.md` — זו רשימת המשימות הפעילה.

### המנגנון של Zoom (הקלטות ענן, לא פגישות חיות)
1. הנגן קורא ל-`/nws/common/2.0/nak` → מקבל **JWT bearer token**.
2. קורא ל-`/nws/recording/1.0/play/info/<token>` עם `Authorization: Bearer <JWT>` → JSON עם **`viewMp4Url`** = MP4 חתום (CloudFront: `data`+`s001`+`s002`+`fid`+`tid`+`Policy`+`Signature`+`Key-Pair-Id`).
3. ה-`<video>` מושך מ-`ssrweb.zoom.us` → MP4 ישיר. **אין HLS, אין DRM, אין MSE.**

### איך ההורדה עובדת אצלנו (popup → SW → offscreen)
- **popup** (`$('downloadZoomVideos')` ב-popup.js): מפענח share URLs (`zoomEnsureResolved`), ושולח את כל ההקלטות כ-**batch אחד** ב-`chrome.runtime.sendMessage({type:'mh-download-recs', jobs:[…], courseName, sourceUrl})`. בורר האיכות הוסר ב-v1.34 — ה-SW בוחר אוטומטית את ה-MP4 הטוב ביותר.
- **background.js** (`_mhProcessQueue` → `_mhDownloadOne`, תור סדרתי): לכל job פותח טאב נסתר → תופס את ה-signed URL (`_mhCaptureSignedUrl`) → סוגר טאב → מתקין כלל **DNR Referer** (`_mhSetRefererRule`, דומיין החשבון) → **offscreen** עושה `fetch` (הקשר תוסף = עוקף CORS) → blob → `chrome.downloads.download(blobUrl)` → מעקב סיום → revoke. במהלך התור הוא מפרסם `mhDlStatus` ב-`chrome.storage.local` (total/completed/failed/current/bytes) שה-popup מציג כ-progress (`renderZoomVideoStatus`), ובסיום רושם רשומה ל-`downloadHistory` (`_mhAppendHistory`).
- **offscreen.html/js**: ה-fetch קורה כאן כי offscreen = origin של התוסף, ו-host_permissions עוקפות CORS (בדף web רגיל CORS חוסם).

### למה כל חלק קיים (לקחים — אל תחזור על המסע!)
- ❌ `chrome.downloads.download(signedUrl)` ישירות → **משבש את ה-URL החתום** → HTML 403 → קובץ `.htm` מבוטל. לכן מורידים `blob:` URL נקי, לא את ה-URL החתום.
- ❌ fetch **בתוך דף ה-Zoom** → כפוף ל-CORS → נחסם. לכן offscreen (הקשר תוסף).
- ✅ **חלק מההקלטות** (replay03) דורשות `Referer: https://<account>.zoom.us/`; אחרות (replay04) לא. לכן כלל ה-DNR מוסיף Referer (fetch לא יכול לקבוע Referer חוצה-origin לבד; DNR **כן** חל על fetch של offscreen, בניגוד ל-chrome.downloads).
- ה-URL החתום מאשר את עצמו (signature). היה באג חיתוך URL ל-600 תווים שמחק את החתימה — תוקן (cap 4000).

### דיבאג (אם משהו נשבר)
- ה-SW מדפיס `[MH] step1/2/3/4 …` ל-Console (chrome://extensions → "service worker" → Console, צריך Developer mode). מראה בדיוק איפה נעצר.
- כפתורי 🩺 דיאגנוסטיקה ו-🔬 מחקר עמוק בפיקר Zoom — מייצרים JSON מלא.

## 🔜 משימות פתוחות

הרשימה הפעילה היא סקציית **🚀 גרסה 2** ב-`ROADMAP-100.md`. כל פריטי הקוד של **V2.0** כבר מומשו (progress, debug UI נקי, הסרת בורר איכויות, היסטוריית הורדות, הודעת VLC, הסרת ממיר VTT). מה שנשאר:

1. **בדיקות שחרור ידניות (V2.0 — חוסם שחרור, רק המשתמש יכול)** — לאמת על קורס אמיתי: קורס חיישנים מלא, הקלטות מ-`replay03` ו-`replay04`, קובץ קטן/בינוני/גדול, וכשל של הקלטה אחת שלא מפיל את כל התור. **רק אחרי שזה עובר → V2 יציבה.**
2. **תת-תיקייה** — לא נתמכת בנתיב ההורדה הנוכחי.
3. **קבצי ענק (1.58GB) / streaming (V2.1)** — כרגע blob שלם בזיכרון (Chrome מגלגל לדיסק, שביר). שדרוג: streaming (File System Access API / OPFS / StreamSaver).
4. **ריפקטור עמוק (V2.1)** — לפרק את `popup.js` למודולים + בדיקות לפונקציות טהורות. **אסור לבצע לפני שיש V2 יציבה לחזור אליה.**
5. **Local Companion לתמלול Whisper (V3, XL)** — כלי מקומי נפרד שמקבל תיקיית MP4 ומפיק TXT/SRT. צריך החלטת המשתמש לפני התחלה.
6. **ניקוי לוגי `[MH]`** — לגדר מאחורי דגל debug (לא דחוף; הם שימושיים לטיפול בתקלות CDN).

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
