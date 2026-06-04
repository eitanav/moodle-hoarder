# Changelog

כל הגרסאות של Moodle Hoarder לפי סדר כרונולוגי הפוך (החדש למעלה). לכל גרסה — מה הייתה הבעיה לפני, מה השתנה, ולמה.

---

## v1.33.4 / 2.0 RC 5 — תיקון רישום Service Worker

- תוקן כשל רישום ה-service worker אחרי Reload: ההיסטוריה ב-background כבר לא מגדירה `DOWNLOAD_HISTORY_KEY` כקבוע גלובלי, כדי למנוע התנגשות declaration שמפילה את `background.js`.
- הורדות Zoom MP4 תלויות ב-service worker; כשהוא לא נרשם, ה-popup יכול להראות שהורדה התחילה אבל בפועל אין worker שמריץ את תור ההורדות.
- ה-manifest הוקפץ ל-`1.33.4` עם `version_name: 2.0 RC 5`, כדי שיהיה ברור שה-build כולל את תיקון ה-worker.

---

## v1.33.3 / 2.0 RC 4 — הסרת ממיר VTT מהפופאפ

- כפתור ה-standalone “המר קובץ VTT לטקסט נקי” הוסר מהפופאפ כדי לא להעמיס על משתמשים רגילים.
- זרימת Zoom עדיין מורידה תמלילים כטקסט נקי כברירת מחדל דרך “קישורים ותמלילים”, ולכן הממיר הידני כבר לא נדרש במסך הראשי.
- ה-manifest הוקפץ ל-`1.33.3` עם `version_name: 2.0 RC 4`, כדי ש-update.bat ו-Chrome Reload יראו בבירור build חדש.

---

## v1.33.2 / 2.0 RC 3 — הסרת בורר איכויות הווידאו

- נוספה תכנית V2/V2.1/V3 ל-ROADMAP: progress להורדות וידאו, הסתרת כלי debug, היסטוריית הורדות אמיתית, בדיקות שחרור, ריפקטור אחרי V2, וכיוון לכלי מקומי לתמלול Whisper.
- הורדות Zoom MP4 נשלחות עכשיו כ-batch ל-service worker, שמפרסם `mhDlStatus` מפורט עם total/completed/failed/current/bytes כדי שה-popup יוכל להציג progress ברור.
- כלי הדיאגנוסטיקה של Zoom הוסתרו מאחורי אזור מתקדם קטן "משהו לא עובד?" במקום להעמיס על המסך הראשי.
- נוספה היסטוריית הורדות אמיתית (`downloadHistory`) לצד `seen_*` של מצב Diff: קורסים, קישורים/תמלילים וסרטוני Zoom עם סטטוס, ספירות וגודל.
- נוספה הערת VLC ל-README למקרים שבהם הנגן המובנה של Windows לא תומך בהגדרות הקידוד של Zoom.
- ה-manifest הוקפץ ל-`1.33.2` עם `version_name: 2.0 RC 3`, כדי ש-update.bat ו-Chrome Reload יציגו בבירור שמותקנת גרסת בדיקה חדשה לפני V2.
- בורר איכות הווידאו הוסר לגמרי מהמסך הראשי עד שנממש בחירת איכות אמיתית; כרגע התוסף מוריד את ה-MP4 הטוב ביותר ש-Zoom חושף בפועל.
- נשמר לוג אבחוני של MP4 candidates ב-service worker כדי להבין בעתיד אם Zoom בכלל חושף כמה רזולוציות לפני שמחזירים בורר איכות.

---

## v1.32.5 — Referer חזרה (ממוקד) — חלק מההקלטות דורשות אותו

הלוגים חשפו: `step2 = http_403`. ה-fetch ב-offscreen מגיע לשרת ונדחה. הסתבר ש**חלק מההקלטות** (כמו חיישנים/replay03) **כן** דורשות `Referer` של דומיין החשבון — בניגוד לאחרות (replay04) שבהן ה-probe קיבל 206 בלי Referer. הבקשה של הדפדפן שעבדה להקלטה הזו אכן נשאה `Referer: https://ariel-ac-il.zoom.us/`.

**התיקון:** fetch לא יכול לקבוע Referer חוצה-origin בעצמו → החזרתי כלל `declarativeNetRequest` ממוקד שמוסיף את ה-Referer (+Origin) של דומיין החשבון לבקשות ssrweb. הוא **כן** חל על ה-fetch של ה-offscreen (xmlhttprequest), בניגוד ל-`chrome.downloads`. בנוסף הוספתי `Range: bytes=0-` ל-fetch (כמו הדפדפן). ההרשאה `declarativeNetRequest` הוחזרה.

---

## v1.32.4 — לוגים מפורטים ב-SW + נתיב גיבוי anchor

כדי לאתר למה לא יורד כלום בלי דיאגנוסטיקה כבדה — הוספתי `console.log` בכל שלב של ההורדה (גלוי ב-Console של ה-service worker שהמשתמש כבר פותח): קבלת הודעה → פתיחת טאב → תפיסת URL → fetch ב-offscreen → chrome.downloads → סיום. כל שלב מדפיס תוצאה, כך שאפשר לראות בדיוק איפה זה נעצר.

בנוסף — **נתיב גיבוי**: אם `chrome.downloads.download(blobUrl)` נכשל (ייתכן שלא יודע לקרוא blob URL מהקשר ה-offscreen), ה-offscreen מוריד בעצמו עם `<a download>`. וניהול חיי ה-blob תוקן (לא משחררים תוך כדי הורדה; backstop של 30 דק' ב-offscreen).

---

## v1.32.3 — הורדה דרך offscreen document (עוקף את חסם ה-CORS)

הורדת ה-fetch-בדף (1.32.1/1.32.2) הורידה כלום. הסיבה: ה-`fetch` רץ **בתוך דף ה-Zoom** (דף web רגיל) → כפוף ל-CORS, וכנראה נחסם. ה-download-probe עבד כי הוא רץ ב**הקשר התוסף** (popup), שם `host_permissions` עוקפות CORS לגמרי.

**התיקון:** מעבירים את ה-fetch ל-**offscreen document** — דף נסתר ב-origin של התוסף, עם host_permissions, **בדיוק ההקשר שבו ה-probe החזיר 206 video**. אין CORS, אין referer, אין cookies-issues.

### הזרימה החדשה (background.js + offscreen.js)
1. ה-worker פותח את דף ההשמעה בטאב נסתר, תופס את ה-signed URL, וסוגר את הטאב.
2. יוצר offscreen document (פעם אחת), שולח לו את ה-URL.
3. ה-offscreen עושה `fetch` (הקשר תוסף → עוקף CORS) → `Blob` → `blob:` URL, ומחזיר אותו.
4. ה-worker שומר עם `chrome.downloads.download({url: blobUrl})` — **URL נקי של blob, בלי חתימה לשבש, בלי רשת/CORS/referer** (נתונים מקומיים → דיסק). מקבל downloadId, עוקב עד סיום, ואז משחרר את ה-blob.

### גם נוסף
- **סטטוס ב-`chrome.storage`** (`mhDlStatus`) — כדי שנראה התקדמות/שגיאה גם בלי התראות מערכת.
- הקובץ מופיע ב-`chrome://downloads` ויורד שם (משוב ברור).
- הרשאת `offscreen`.

### למה זה אמור לעבוד הפעם
ה-fetch רץ עכשיו ב**אותו הקשר** שבו ה-probe הצליח (206 video), וההורדה היא של `blob:` URL נקי דרך chrome.downloads — שני חלקים מוכחים/בטוחים. אם עדיין נכשל — `mhDlStatus` ב-storage או ה-Console של ה-service worker יראו את השגיאה המדויקת.

---

## v1.32.2 — ניקוי: הסרת קוד מת + ה-DNR/Referer המיותר

לאחר המעבר להורדה דרך ה-background worker, נשאר הרבה קוד יתום וגם מנגנון Referer שהוכח מיותר. ניקיתי (בלי לשנות התנהגות של נתיבים חיים; אומת ב-`node --check` + בדיקת אפס-הפניות):

### הוסר
- **כל מנגנון ה-Referer/DNR** — `ensureZoomReferrerRule`, הכלל הדינמי, והרשאת `declarativeNetRequest`. הוכח (download-probe) ש-Referer לא רלוונטי: ה-URL החתום מאשר את עצמו. בונוס: מונע הפרעה אפשרית ל-fetch בתוך הדף.
- **~263 שורות קוד מת בפופאפ** — נתיב ההורדה הישן (`downloadZoomRecordings`, `extractRecordingCandidates`, `resolveRecordingCandidates`, `downloadResolvedRecordings`) ומנגנון בורר האיכות (`summariseResolutions`, `chooseQualityDialog`, `pickRecordingUrlByLabel`, `pickRecordingUrl`, `_resolutionScore`, `_resolutionLabel`). הכל הוחלף ע"י נתיב ה-fetch-בדף ב-background.
- ה-download-probe בדיאגנוסטיקה פושט ל-fetch בודד (בלי ריקוד with/without referer).

### נשאר (במכוון)
- הרשאת `debugger` — נחוצה ל-🔬 מחקר עמוק.
- ה-modal של בורר האיכות (HTML) — שמור לשִחזור 'שאל אותי' בנתיב ה-SW.

### עדיין פתוח
- אימות שכפתור 🎥 אכן מוריד MP4 (טרם נבדק).
- 'שאל אותי' מתנהג כמו 'הטובה ביותר'; תת-תיקייה לא נתמכת בנתיב ה-anchor.

---

## v1.32.1 — תיקון: ה-fetch בתוך הדף נחסם ע"י CORS-credentials

ב-1.32.0 ה-fetch בתוך הדף השתמש ב-`credentials: 'include'`. זו בקשה **חוצת-origin** (ariel-ac-il.zoom.us → ssrweb.zoom.us), ועם `include` הדפדפן דורש `access-control-allow-credentials: true` בתגובה — שאינו קיים → **קריאת התגובה נחסמת**, אין blob, ההורדה נכשלת. (ב-probe מהפופאפ זה עבד כי host-permissions עוקפות CORS לגמרי; בדף אין עקיפה.)

**תיקון:** ה-URL החתום מאשר את עצמו ולא צריך cookies → `credentials: 'omit'`. עכשיו קריאת התגובה מותרת (ACAO תואם את ה-origin של הדף עבור בקשה לא-מאומתת).

> הבהרה לגבי מחקר Gemini: הוא עוסק ב**פגישות Zoom חיות** (WebRTC/Canvas/E2EE) ששם רק הקלטת מסך עובדת. המקרה שלנו הוא **הקלטות ענן (VOD)** — MP4 ישיר, וה-probe מוכיח שהוא נתפס ונמשך. אז הגישה שלנו נכונה; אין צורך בהקלטת מסך.

---

## v1.32.0 — הורדת וידאו דרך fetch בתוך הדף (כמו מורידי הווידאו האמיתיים)

הראיה הסופית מה-🩺 probe: על אותו URL מלא — `fetch()` מחזיר **206 video/mp4**, אבל `chrome.downloads.download()` מחזיר **HTML 403** (נשמר כ-`.htm` מבוטל). כלומר הבעיה **לא** ב-URL ולא ב-Referer — היא ב-`chrome.downloads` עצמו (כנראה מקודד מחדש את ה-URL ומשבש את חתימת CloudFront, או לא שולח את ההקשר המאומת).

### הפתרון — מה שמורידי וידאו אמיתיים עושים

מפסיקים לתת ל-`chrome.downloads` לגעת ב-URL. במקום זה **מושכים את הבייטים עם `fetch` ושומרים אותם**:

1. ה-background worker פותח את דף ההשמעה בטאב נסתר, תופס את ה-signed URL.
2. מריץ **בתוך הדף** (origin של zoom — cookies + CORS תקינים; תגובת ה-MP4 נושאת `access-control-allow-origin` לדומיין החשבון) `fetch(url, {credentials:'include'})` → `blob` → `<a download>` click.
3. רץ ב-worker (שורד סגירת פופאפ) עם **תור סדרתי** (blob אחד גדול בזיכרון בכל פעם; Chrome מגלגל blobים גדולים לדיסק).
4. ממתין לסיום ההורדה האמיתית (`chrome.downloads.onChanged`) לפני סגירת הטאב, ואז **התראה** ✅/❌ לכל הקלטה.

### מגבלות בגרסה הזו

- **'שאל אותי' מתנהג כרגע כמו 'הטובה ביותר'** בנתיב הזה (בורר האיכות יחזור בהמשך).
- **בלי תת-תיקייה** (anchor download לא תומך בנתיב). הקובץ יורד ל-Downloads.
- כלל ה-Referer/DNR שנשאר מיותר — יוסר בניקוי.

### איך לבחון

עדכן ל-1.32.0 (update.bat → Reload) → סרוק → בחר הקלטה → 🎥. ייפתח טאב נסתר, יימשך הווידאו (דקות לקובץ גדול), תופיע התראה "✅ ירד", והקובץ יהיה `.mp4` שמתנגן. **לא נבדק על ידי המפתח — אנא אשר.**

---

## v1.31.3 — ✅ אומת: ה-URL מוריד וידאו אמיתי (Referer מיותר)

הרצת 🩺 על 1.31.2 (עם תיקון החיתוך) נתנה את התשובה הסופית — ה-download-probe על ה-URL ה**מלא** (1776 תווים):

```
withoutReferer: { status: 206, contentType: "video/mp4", isVideo: true }
withReferer:    { status: 206, contentType: "video/mp4", isVideo: true }
```

**מסקנות סופיות:**
1. ה-URL החתום (CloudFront: `data`+`s001`+`s002`+`fid`+`tid`+`Policy`+`Signature`+`Key-Pair-Id`) **מאשר את עצמו** — מחזיר 206 video/mp4 **עם ובלי Referer, עם ובלי cookies**.
2. **כל תיאוריית ה-Referer הייתה מיותרת.** כל ה-`.htm` בעבר נבעו מ-URL **חתוך/שגוי** שנתפס (החיתוך ל-600/500 תווים מחק את החתימה), לא מהרשאות.
3. נתיב ההורדה האמיתי (`extractRecordingCandidates`) תופס את ה-URL **המלא** ומעביר אותו ל-`chrome.downloads`. עם ה-URL המלא, התגובה היא `video/mp4` → נשמר כ-`.mp4` תקין.

**מצב:** ההורדה אמורה לעבוד ב-1.31.2+. ממתינים לאישור המשתמש שכפתור 🎥 מוריד MP4 שלם (~1.58GB בהקלטה שנבדקה).

**ניקוי עתידי:** אפשר להסיר את כלל ה-DNR (`ensureZoomReferrerRule`) ואת הרשאת `declarativeNetRequest` — הוכח שהם מיותרים.

---

## v1.31.2 — באג חיתוך URL פסל את כל אבחוני ה-Referer

ה-🩺 download-probe חשף ש**ה-Referer לא משנה כלום** — גם עם וגם בלי, התקבל 403 זהה. אבל מצאתי למה: ה-monitor שתופס URLs **חתך כל URL ל-600 תווים** (`s.slice(0, 600)`). ה-URL החתום של CloudFront ארוך ~1500–2500 תווים, וה-`Signature`/`Key-Pair-Id` בסוף — החיתוך מחק אותם → 403 AccessDenied **מובטח**. כל ה-probe בדק URL פגום. (נתיב ההורדה האמיתי לא חתך, אבל ה-probe הטעה אותנו לעבר תיאוריית ה-Referer.)

### תיקונים

1. **חיתוך 600→4000** ב-monitor (popup) וב-deep-research (background, 500→4000) — נתפס ה-URL המלא עם החתימה.
2. **download-probe עם `credentials: 'include'`** — שולח cookies כמו הדפדפן.
3. **תופס את גוף השגיאה** (`errorBody`) של S3/CloudFront — יגיד מילולית: AccessDenied / Missing Key-Pair-Id / Request has expired.
4. ה-verdict עודכן בהתאם.

### איך לבחון

עדכן (update.bat → Reload, 1.31.2) → 🩺 דיאגנוסטיקה → שלח את `download-probe`. הפעם ה-URL מלא וה-fetch עם cookies — נדע **סוף-סוף** אם ה-URL המלא מחזיר וידאו, ואם לא — את הסיבה המדויקת מ-S3.

---

## v1.31.1 — תיקון RTL בעמוד ההגדרות

המשתמש דיווח: "ה-RTL באתר ההגדרות מבולגן בטירוף, קשה לקרוא, כל המילים מתחילות בשמאל". סקירת ה-CSS חשפה כמה בעיות אמיתיות:

### מה היה שבור

1. **`<code>` בתוך עברית התהפך:** `<code>&lt;html lang&gt;</code>` הופיע בכיוון שגוי בתוך משפט עברי, כי מנוע ה-bidi התייחס אליו כחלק מהריצה ה-RTL. הפלט נראה כמו `&gt;gnal lmth&lt;`.
2. **חוסר עוגן `text-align` מפורש:** למרות `dir="rtl"` ב-`<html>`, ה-flex containers (כמו `.row .label`) לא תמיד הורישו את `text-align: start` נכון בכל הדפדפנים. תוצאה: שורות שעטופות (wrap) נראו כאילו מתחילות מהשמאל.
3. **טוגל ה-iOS-style** השתמש ב-`right: 2px` ו-`right: 20px` — כיוון פיזי קבוע. בכוונה תחילה זה עבד ב-RTL באקראי, אבל היה backwards ב-LTR (משתמש שעבר ל-English ראה toggle הפוך).
4. **toast הסטטוס "✓ נשמר"** הופיע ב-`right: 24px` — בפינה הימנית-תחתונה גם ב-RTL. בעמוד RTL, הקצה הוויזואלי הוא **שמאל**, אז ה-toast צריך להופיע שם.

### מה תוקן

- `body` קיבל `direction: rtl` ו-`text-align: right` מפורשים — לא מסתמך על הירושה.
- `code` קיבל `unicode-bidi: isolate` + `direction: ltr` — נותן ל-snippet הקוד הקשר LTR מבודד בתוך שטף ה-RTL. עכשיו `<code>...</code>` מופיע נכון.
- `.hint strong` קיבל את אותו `unicode-bidi: isolate`.
- `text-align: right` הוסף מפורש על `.label`, `.name`, `.hint`, `section h2`, `section .desc`, `header h1`, `header .sub` — defensive layering.
- ה-toggle עבר מ-`right: 2px/20px` ל-`inset-inline-start: 2px/20px` — מאפיין לוגי שמסתגל אוטומטית: ב-RTL מתחיל מימין ונוסע שמאלה, ב-LTR מתחיל משמאל ונוסע ימינה. נכון בשני הכיוונים.
- ה-toast עבר מ-`right: 24px` ל-`inset-inline-end: 24px` — מופיע בקצה הוויזואלי הנכון בכל כיוון.
- `header` עודכן: `flex: 1` על המכל הפנימי כדי שה-h1 וה-sub יקבלו רוחב לעבד `text-align: right` נכון.
- `.hint` קיבל `font-size: 12px` (מ-11px) ו-`line-height: 1.6` — הקריאות שופרה במקביל.
- `table.history` עבר מ-`text-align: right` ל-`text-align: start` — לוגי, תקין גם ב-LTR.

### איך לבחון

1. `update.bat` (או `git pull` + Reload התוסף)
2. ⚙ בפופאפ → עמוד ההגדרות נפתח
3. תראה כל סקציה: כותרות וטקסטים מיושרים לימין בעקביות
4. `<code>` באמצע משפט עברי (למשל הסבר על `course.json`) — מופיע במקום הנכון, קריא
5. שמור הגדרה כלשהי (טוגל / רדיו) → ה-toast "✓ נשמר" קופץ בפינה השמאלית-תחתונה (במקום הימנית)
6. הזז טוגל הלוך-חזור — הכפתור הלבן מחליק נכון: ימין (כבוי) → שמאל (פעיל) ב-RTL

---

## v1.31.0 — 🎯 פיצחנו את המנגנון: Referer של דומיין החשבון

המחקר העמוק (chrome.debugger) סוף סוף תפס את **בקשת ה-MP4 האמיתית** (ה-`<video>` — בלתי נראית ל-fetch/XHR). מתוך ה-trace:

### המנגנון המלא של אריאל/Zoom

1. הנגן קורא ל-`/nws/common/2.0/nak?pms=Recording...` → מקבל **JWT bearer token** (קשור ל-session/cookies).
2. קורא ל-`/nws/recording/1.0/play/info/<token>?originDomain=...` עם **`Authorization: Bearer <JWT>`** → ה-JSON מחזיר שדה **`viewMp4Url`** = ה-URL החתום המלא (S3 presigned: `data=`, `s001`, `cid`, `fid`, `s002`, `tid`).
3. ה-`<video>` מושך מ-`ssrweb.zoom.us` עם `Range: bytes=0-` ו-**`Referer: https://ariel-ac-il.zoom.us/`** → **206 Partial Content**, `video/mp4`, ~115MB, `server: AmazonS3`. **אין HLS, אין DRM, אין MSE — MP4 ישיר.**

### הבאג שתוקן

v1.28 הגדיר `Referer: https://zoom.us/`, אבל ה-CDN דורש את **דומיין החשבון** `https://ariel-ac-il.zoom.us/`. ה-Referer השגוי → 403 HTML → Chrome שומר כ-`.htm` ומבטל ("File wasn't available on site"). זה **בדיוק** מה שראינו בצילומים.

**התיקון:** `ensureZoomReferrerRule(refererOrigin)` גוזר עכשיו את ה-origin מתוך ה-share URL (`new URL(shareUrl).origin`) ומגדיר את ה-Referer/Origin לדומיין החשבון הנכון. כך זה עובד לכל מוסד (לא רק אריאל).

### איך לבחון

1. עדכן ל-1.31.0 (update.bat → Reload).
2. סרוק → בחר הקלטה → 🎥 הורד סרטונים → אמור לרדת **`.mp4`** תקין שמתנגן.
3. אם עדיין נכשל — 🔬 מחקר עמוק, ושלח את ה-JSON (שלב `download-probe` מראה אם withReferer מחזיר וידאו).

> **לסשן הבא:** אם ה-Referer לבד לא מספיק, הדרך החסינה היא לחקות את ה-API: לתפוס את תגובת `play/info` (יש בה `viewMp4Url` מלא) דרך ה-debugger/Network שכבר קיים ב-background, ולהוריד את ה-URL הזה ישירות. זה עוקף לגמרי את תפיסת ה-`<video>.src`.

---

## v1.30.0 — תיקון קריטי: המחקר העמוק רץ ב-service worker (לא נסגר עם הפופאפ)

המשתמש הריץ 🔬 וכלום לא קרה: הטאב נפתח בחזית אבל שום דבר לא זז/ירד.

### הבאג

`deepZoomResearch` רץ בתוך הפופאפ ופתח טאב עם `active:true`. פתיחת טאב ממוקד **מעבירה את הפוקוס ומסגירה את הפופאפ** → כל הסקריפט מת באמצע (אותו שורש כמו באג ה-saveAs). הטאב נשאר פתוח, ה-debugger מתנתק, אין תוצאה.

### התיקון

המחקר עבר ל-**background service worker** (שרץ ברקע ולא מושפע מסגירת פופאפ):

1. הפופאפ מחלץ את קישור ה-share (טאבים נסתרים — נשאר פתוח) ושולח הודעה `mh-deep-research` ל-worker.
2. ה-worker פותח את הטאב, מצמיד `chrome.debugger`, מקליט ~22 שניות בזמן שהנגן מתנגן, מושך גופי תגובות, ומסכם.
3. בסיום: שומר ב-`storage`, **מוריד קובץ `zoom-deep-research_*.json`** (data URL — לא תלוי בפופאפ), ומציג **התראה**.
4. אם הפופאפ פתוח במסך Zoom — התוצאה גם מוצגת בתיבת הטקסט אוטומטית.

הקוד המת של המחקר הוסר מהפופאפ (עבר ל-background).

### איך לבחון

1. טען מחדש את התוסף (1.30.0).
2. סרוק → בחר הקלטה אחת → 🔬 מחקר עמוק. ייפתח טאב, הנגן ינוגן ~30 שניות, הטאב ייסגר לבד, ותופיע התראה + יירד קובץ JSON.
3. פתח את הקובץ ושלח לי — או פתח שוב את הפופאפ במסך Zoom והעתק משם.

---

## v1.29.0 — מחקר עמוק: network trace מלא עם chrome.debugger

תיקון ה-Referer (v1.28) לא פתר — עדיין יורדים קבצי `.htm` מבוטלים. הסיבה שאנחנו תקועים: כל הדיבאג עד עכשיו התבסס על monkey-patch ל-fetch/XHR, אבל **בקשת ה-`<video>` שמושכת את ה-MP4 לא עוברת דרך fetch/XHR** — אז היינו עיוורים בדיוק לבקשה הקריטית, ולא ראינו את ה-headers/status/גוף-השגיאה האמיתיים. מפסיקים לנחש.

### כלי 🔬 מחקר עמוק

כפתור חדש שמשתמש ב-`chrome.debugger` (Network domain, נדרשה הרשאת `debugger`) כדי להקליט ברמת הדפדפן את **כל** בקשות הרשת בזמן שהנגן מתנגן:

- **request headers מלאים** — Referer, Cookie (שמות בלבד, ערכים מצונזרים), Range, Authorization, Sec-Fetch-*.
- **response** — status, statusText, mimeType, response headers, redirects, remote IP, גודל.
- **גוף תגובות שגיאה/HTML** (לא בינאריים גדולים) — כך נראה מילולית מה Zoom מחזיר כשהוא דוחה (פג? נחסם? צריך cookie?).
- **מצב הנגן הסופי** — `<video>.currentSrc`, readyState, error code.
- **summary** — בקשת הווידאו המנגנת (`foundPlayingMediaUrl`) וה-headers שלה, בקשות ssrweb/HLS/שגיאה.

זה חושף בדיוק איך אריאל/Zoom מגישים את הווידאו, וממנו נדע איך לשכפל את ההורדה.

### איך לבחון

1. **טען מחדש את התוסף** (chrome://extensions → Reload) — חובה, הרשאה חדשה.
2. סרוק → בחר הקלטה אחת → לחץ **🔬 מחקר עמוק**. ייפתח טאב, ייתכן באנר "started debugging" (תקין). חכה ~30 שניות.
3. לחץ **📋 העתק הכל** ושלח את ה-JSON. ממנו נבין את המנגנון המדויק.

---

## v1.28.0 — תיקון הורדת הווידאו: כותרת Referer ל-CDN של Zoom

המשתמש שיתף צילום מסך: ההורדות נכשלות כקבצי `.htm` עם **"File wasn't available on site"**, עם שמות של הקלטות (`חיישנים_2026-04-26_10-03.htm`).

### האבחנה

`.htm` + "File wasn't available" = ה-CDN של Zoom (`ssrweb.zoom.us`) מחזיר **דף שגיאת HTML (403)** במקום הווידאו. הסיבה: בקשת ההורדה לא נושאת כותרת `Referer: https://zoom.us/`. הנגן (`<video>`) שולח אותה אוטומטית — אבל `chrome.downloads.download` (ובקשת fetch רגילה מהתוסף) לא. ה-CDN דוחה, מחזיר HTML, ו-Chrome שומר אותו כ-`.htm`.

### התיקון

1. **כלל `declarativeNetRequest`** (`ensureZoomReferrerRule`) שמוסיף `Referer: https://zoom.us/` + `Origin` לכל בקשה ל-`ssrweb.zoom.us`. מותקן אוטומטית לפני כל הורדת וידאו. נדרשה הרשאת `declarativeNetRequest` ב-manifest (host permissions ל-`*.zoom.us` כבר היו).
2. **שלב "download-probe" בדיאגנוסטיקה** — אחרי שמוצא signed MP4, מושך את הבייטים הראשונים **עם ובלי** ה-Referer ומדווח `content-type`/`status`. כך הקובץ מאשר חד-משמעית: HTML ללא Referer + וידאו עם Referer = הבאג אובחן ותוקן. ה-verdict מתעדכן בהתאם (כולל `refererFixedIt`).

### איך לבחון

1. טען מחדש את התוסף (chrome://extensions → Reload) — חובה בגלל הרשאה חדשה.
2. סרוק דף הקלטות Zoom → בחר הקלטה → 🎥 הורד סרטונים. אמור לרדת `.mp4` תקין.
3. אם עדיין נכשל — לחץ 🩺 דיאגנוסטיקה והעתק את התוצאה; `download-probe` יראה אם זו בעיית Referer, פקיעת URL, או פורמט.

---

## v1.27.0 — איחוד: בורר איכות אמיתי + כלי דיאגנוסטיקה

שני session-ים נפרדים פיתחו במקביל מאותו בסיס (v1.25.0): אחד בנה כלי **דיאגנוסטיקה** להורדת וידאו (ראה v1.26.0/v1.26.1 למטה), והשני בנה **בורר איכות אמיתי**. נוצרה התנגשות מספרי גרסה (שני "v1.26.0"). הגרסה הזו מאחדת את שניהם לברנץ׳ אחד נקי. `popup.js`/`popup.html` התמזגו אוטומטית בלי התנגשות.

### פיצ'ר: בורר איכות אמיתי ("שאל אותי") עם דיאלוג בחירה

ב-v1.25 בורר האיכות "שאל אותי" התנהג בדיוק כמו "הטובה ביותר" — לא הייתה שאלה בפועל. עכשיו הזרימה של 🎥 פוצלה לשני שלבים כדי לאפשר שאלה באמצע **בלי לחלץ פעמיים** (קישורים חתומים פגים אחרי ~שעתיים):

1. **שלב איתור** (`resolveRecordingCandidates`) — אוסף את **כל** הקישורים החתומים (כל הרזולוציות) במקביל.
2. **דיאלוג בחירה** — `summariseResolutions` + `chooseQualityDialog`: מודאל בפופאפ עם הרזולוציות הייחודיות; המשתמש בוחר.
3. **שלב הורדה** (`downloadResolvedRecordings`) — מוריד מהקישורים שכבר נאספו, לפי הבחירה (`pickRecordingUrlByLabel`, נופל לרזולוציה הקרובה ביותר).

"הטובה ביותר"/"הקטנה ביותר" ללא שינוי; `downloadZoomRecordings` הפך ל-wrapper דק. רזולוציה אחת בלבד → מדלג על הדיאלוג. ביטול/Esc/רקע → עוצר.

### גם כלול: כלי הדיאגנוסטיקה (v1.26.0+v1.26.1)

כפתור 🩺 לבדיקת כל הצנרת שלב-אחר-שלב + verdict בעברית. הפרטים בערכי v1.26 למטה.

---

## v1.26.1 — תיקון: הקובץ לא ירד + הצגת התוצאה בפופאפ

המשתמש דיווח ש**שום קובץ לא ירד** מכפתור הדיאגנוסטיקה.

### הבאג

הורדתי עם `saveAs:true`. דיאלוג השמירה של המערכת גוזל פוקוס → הפופאפ נסגר מיד → ה-blob URL (שמקושר ל-document של הפופאפ) מתבטל → ההורדה מבוטלת. לכן לא ירד כלום.

### התיקון

1. **הורדה שקטה** (`saveAs:false`) — ישר לתיקיית ההורדות, בלי דיאלוג שגוזל פוקוס.
2. **הצגת ה-JSON בתוך הפופאפ** בתיבת טקסט + כפתור "📋 העתק הכל" — הדרך החסינה, לא תלויה בהורדה בכלל. אפשר פשוט להעתיק ולהדביק בצ׳אט.
3. Console כגיבוי שלישי.

---

## v1.26.0 — כלי דיאגנוסטיקה להורדת וידאו Zoom

המשתמש דיווח שהורדת הווידאו פשוט לא עובדת — ובמקום סרטונים יורדים קובצי HTML, ולפעמים שום דבר לא יורד. במקום לנחש איפה השבר, בניתי כלי דיבאג עצמאי (כלל הזהב #7 — debug-driven).

### למה זה לא עבד / מה היה חסר

1. **קובצי ה-HTML** הם דאמפ דיבאג: כש-`resolveZoomPlayUrls` לא מחלץ אף קישור (`ok === 0`), כפתור 📄 שומר את ה-HTML של דף הפרטים (`zoom-detail-debug_*.html`) — לא הקלטה. כלומר השורש הוא שחילוץ ה-share URL נכשל, וזה מפיל גם את 🎥 וגם את 📄.
2. **הדיבאג הקודם** (`captureZoomNetworkDebug`, checkbox) רץ **רק אחרי** ש-resolve הצליח (`if (debugChk?.checked && withUrls.length)`) — בדיוק התרחיש שאי אפשר לתפוס בו את הכשל.
3. **"לא ירד כלום"** — סביר שהפופאפ נסגר באמצע הזרימה הארוכה, וה-blob URL שנוצר בו התבטל לפני שההורדה התחילה.

### מה נוסף

כפתור **🩺 דיאגנוסטיקה** בפיקר ה-Zoom שמריץ את כל הצנרת על ההקלטה הראשונה ומתעד כל שלב:

1. **list-page** — צילום של כל ה-frames: טבלאות, שורות עם מזהה פגישה, סלקטורים מוכרים, זיהוי מסך התחברות.
2. **click-row** — האם `clickRecordingRow` הצליח.
3. **detail-page** — צילום דף הפרטים: כל האלמנטים שנראים כמו כפתור Play (class/aria-label/title), קישורי `zoom.us/rec`.
4. **capture-share-url** — מה נתפס מ-`window.open` בלחיצה על Play.
5. **player-network-probe** — פותח את קישור ה-share בטאב נסתר עם monitor **לא מסונן** (כל כתובת שהנגן נוגע בה, לא רק `ssrweb .mp4`), לוחץ Play, ומסווג: signed MP4 / HLS / blob / ssrweb.

בראש הקובץ יש **`summary.verdict`** — אבחנה בעברית פשוטה שמצביעה על השלב שנשבר.

### חזק יותר נגד אובדן הקובץ

- מדפיס את כל ה-JSON ל-**Console** לפני ההורדה (שורד גם אם הפופאפ נסגר).
- מוריד עם `saveAs:true` כדי שבטוח תראה את הקובץ.
- קורא ל-resolver הקיים **read-only** בלבד (כלל זהב #1 — לא נגעתי בו).

### איך לבחון

1. פתח דף הקלטות Zoom במודל וסרוק.
2. לחץ **🩺 דיאגנוסטיקה**, השאר את הפופאפ פתוח ~40 שניות.
3. שלח את `zoom-diagnostic_*.json` (או את הפלט מה-Console) — ה-verdict יגיד מיד איפה הבעיה.

---

## v1.25.0 — שני כפתורי Zoom נפרדים + בורר איכות + תיקון הורדת וידאו

המשתמש דיווח שהורדת הוידאו לא עבדה, וביקש כפתור נפרד + בורר איכות.

### למה זה לא עבד ב-v1.24

הורדת הוידאו הייתה מאחורי הגדרה `downloadRecordings` שכבויה כברירת מחדל ומוסתרת בעמוד ההגדרות. המשתמש (בצדק) לא הפעיל אותה. הפתרון: **כפתור ייעודי** שתמיד עובד.

### שני כפתורים נפרדים

הכפתור היחיד "פענח קישורים והורד" התפצל לשניים בפיקר ה-Zoom:

- **📄 קישורים ותמלילים** — מהיר, מייצר ZIP עם הקישורים + התמלילים (כמו קודם)
- **🎥 הורד סרטונים (MP4)** — מוריד את הוידאו עצמו כקבצי MP4

שניהם משתפים את שלב חילוץ ה-share URLs (שמתבצע פעם אחת, נשמר על ההקלטה כך שלחיצה על הכפתור השני לא מבזבזת זמן).

### בורר איכות

dropdown חדש מעל הכפתורים:
- **הטובה ביותר** (ברירת מחדל) — הרזולוציה הגבוהה ביותר הזמינה
- **הקטנה ביותר** — חוסך מקום
- **שאל אותי** — (כרגע מתנהג כמו "הטובה ביותר"; prompt אמיתי בעתיד)

### חילוץ URL חזק יותר

`extractRecordingCandidates` (החליף את `extractRecordingUrl`) משתמש עכשיו ב**אותה גישת monitor שהוכחה ב-debug capture**:
- מתקין MutationObserver על `<video>`/`<source>` src **לפני** הלחיצה על Play (כדי לא לפספס)
- patch ל-fetch + XHR שתופס כל ssrweb signed URL
- אוסף **כל** ה-URLs (לא רק הראשון) → מאפשר בחירת איכות
- מפרסר רזולוציה משם הקובץ (`Recording_1366x768.mp4` → 1366×768)

`pickRecordingUrl` בוחר לפי ההעדפה: best = הגבוה ביותר, smallest = הנמוך ביותר.

### שמות קבצים

`<topic>_<YYYY-MM-DD_HH-MM>.mp4` — למשל `חיישנים_2026-05-24_10-12.mp4`.

### הסרת הטוגל הישן

ההגדרה `downloadRecordings` הוסרה (היה מבלבל — שתי דרכים להפעיל אותו דבר). עכשיו רק הכפתור.

### איך לבחון

1. דף Zoom של אריאל → סרוק → בחר 1 הקלטה
2. בחר איכות (או השאר "הטובה ביותר")
3. לחץ **🎥 הורד סרטונים**
4. אחרי ~25 שניות (חילוץ URL ברקע) — ההורדה מתחילה ב-Chrome
5. אפשר לסגור את הפופאפ — ממשיך ברקע

אם נכשל — ה-status יראה את השגיאה הראשונה (למשל "לא נתפס קישור וידאו").

---

## v1.24.0 — 🎥 הורדת הקלטות וידאו אמיתיות מ-Zoom! (Phase 1)

**זה הפיצ'ר הגדול.** ה-debug capture של v1.23 חזר עם החדשות הכי טובות שאפשר:

```
mediaElementSrcs: [
  "https://ssrweb.zoom.us/replay03/2026/05/24/.../GMT...Recording_1366x768.mp4?...&Signature=...&Key-Pair-Id=..."
]
mseActivity: 0      ← אין MediaSource = אין HLS, אין DRM
hlsManifests: 0     ← לא HLS
videoElementCount: 1
playClicked: "[title=\"Play\" i]"
```

**המסקנה:** Zoom של אריאל מגיש הקלטות כ-**MP4 ישיר** עם **signed CloudFront URL** שיושב ישירות על ה-`<video>` element. אין segments, אין הצפנה, אין הרכבה. ה-signature מוטמע ב-query string, אז ה-URL עובד עצמאית בלי cookies.

**הפתעה אדירה:** מאחר וה-signed URL עובר ישירות ל-`chrome.downloads.download`, וה-API הזה רץ ברמת ה-browser (לא ב-popup) — **ההורדה ממשיכה גם אם סוגרים את הפופאפ.** זה עוקף את כל הצורך ב-#80 (service worker downloads) עבור הוידאו. Phase 1 ירד מ-4-6 שעות ל-2-3.

### מה נוסף

**`extractRecordingUrl(rec)`** — פותח את ההקלטה ב-tab רקעי, לוחץ Play (אותם 10+ סלקטורים מ-debug), ו-polls את ה-`<video>` element עד שה-`currentSrc` הוא ssrweb signed MP4 (לא blob:). עד 25 שניות.

**`downloadZoomRecordings(recordings, ...)`** — worker pool (ברירת מחדל 2 במקביל) שלכל הקלטה:
1. מחלץ את ה-URL
2. שולח ל-`chrome.downloads.download({ url, filename })`
3. שם הקובץ: `<topic>_<YYYY-MM-DD_HH-MM>.mp4` (אותו naming של תמלילים)
4. נשמר ב-Downloads או בתת-תיקייה שהגדרת

**הגדרה חדשה `downloadRecordings`** — טוגל בהגדרות → Zoom. **כבוי כברירת מחדל** (קבצים של 200MB-2GB, opt-in מודע).

### הזרימה המשולבת

כשמורידים הקלטות Zoom, הסדר עכשיו:
1. חילוץ share URLs (כמו תמיד)
2. תמלילים → ZIP (אם `extractTranscripts`)
3. **הקלטות וידאו → קבצי MP4 נפרדים** (אם `downloadRecordings`) ← חדש
4. debug capture (אם סומן)

הוידאו **לא** נכנס ל-ZIP — הוא יורד כקבצים נפרדים. ככה אין בעיית memory והמשתמש מקבל:
```
חיישנים הקלטות_2026-05-31.zip          ← רזה: קישורים + תמלילים
חיישנים_2026-05-24_10-12.mp4            ← קובץ וידאו נפרד
חיישנים_2026-05-17_10-04.mp4            ← קובץ וידאו נפרד
```

### מגבלות ידועות

- **TTL של ה-signed URL:** ~שעתיים. חייב לחלץ ולהוריד באותו session. אם ההורדה לא מתחילה תוך שעתיים מ-Play — תיכשל. בפועל לא בעיה כי ההורדה מתחילה מיד.
- **רק האיכות שהנגן בוחר:** כרגע תופס את מה ש-`<video>` מנגן (ראיתי `1366x768`). אם Zoom מציע כמה רזולוציות, נצטרך לבחור בעתיד.
- **סדרתי-יחסית:** 2 במקביל כדי לא להעמיס. אפשר לכוונן דרך אותו `transcriptConcurrency`.
- **blob: URL fallback:** אם הנגן משתמש ב-blob URL (MSE) במקום signed URL ישיר — לא נוכל להוריד ישירות, יסומן כ-error. לא ראינו את זה באריאל, אבל מוגן.

### איך לבחון

1. הגדרות → Zoom → **הפעל "הורדת קובצי הוידאו (MP4)"**
2. דף Zoom של אריאל → סרוק → בחר 1-2 הקלטות
3. לחץ "פענח קישורים והורד"
4. אחרי URLs + תמלילים, יתחיל שלב 🎥 — tab רקעי, Play, חילוץ URL
5. ההורדה של ה-MP4 מתחילה — **אפשר לסגור את הפופאפ, היא תמשיך**
6. ב-Downloads: `<topic>_<date>.mp4`

---

## v1.23.0 — Phase 0 — Debug capture לחקירת הורדת הקלטות וידאו

המשתמש ביקש פיצ'ר חדש קריטי: **הורדת הקלטות וידאו אמיתיות מ-Zoom**, לא רק URLs וקטעי תמליל. לפני שאני כותב שורת קוד אחת של ההורדה עצמה, אני חייב לדעת איך Zoom של אריאל מגיש את הוידאו:

1. **MP4 ישיר** — fetch אחד, signed URL. קל יחסית להוריד.
2. **HLS** — manifest .m3u8 + עשרות-מאות segments .ts. דורש הרכבה מורכבת.
3. **DRM** — מוצפן, אי אפשר.

**Phase 0 = debug capture ייעודי לזיהוי הזרימה.** מבוסס על אותה ארכיטקטורה של ה-debug של תמלילים (v1.18) שעבד פעם הראשונה.

### מה שונה ב-v1.23

`captureZoomNetworkDebug` שודרג מ-v1 ל-v2:

- **monkey-patch רחב יותר** — תופס video/audio/mp4/m3u8/ts/octet-stream/mpegurl/range, לא רק VTT
- **MediaSource monitor חדש** — אם הנגן משתמש ב-MSE (HLS/DASH), כל `addSourceBuffer` ו-`appendBuffer` עם הגודל של ה-buffer מתועד. זה הסיגנל המכריע לזהות HLS/DASH.
- **mediaElementSrcs** — MutationObserver שתופס `<video src>` ו-`<audio src>` שהנגן מציב — לפעמים זה blob URL או MP4 ישיר
- **לחיצה אוטומטית על Play** — בלי זה הנגן לא מתחיל לזרום וידאו. מנסה 10+ סלקטורים שונים (zm-control-button-play, vjs-play-control, role="button" aria-label="play" וכו')
- **20 שניות streaming** — מספיק לראות byte-range chunks או segments מרובים
- **classification מובנה** ב-JSON output — כל request מקוטלג מראש ל-videoCandidates / hlsManifests / hlsSegments / transcriptCandidates / apiCallsSample. אני לא צריך לחפש בידיים בתוך מאות requests.
- **content-range + accept-ranges + request headers** מתועדים — חשובים לזיהוי האם השרת תומך ב-range requests (ביצוע סטרימי)

### Toggle

הצ'קבוקס שכבר היה בפיקר Zoom שונה תווית: 🎬 (במקום 🔬) ועדכון תווית — "לחקירת הורדת וידאו". ה-cap הורד מ-5 ל-2 הקלטות (לוידאו אין צורך בהרבה דגימות).

### איך לבחון

1. סרוק דף Zoom של אריאל
2. סמן 1-2 הקלטות (מעוטות — כל אחת לוקחת ~25 שניות)
3. **סמן את ה-checkbox 🎬**
4. לחץ "פענח קישורים והורד"
5. ה-extension עושה את הזרימה הרגילה (URL + תמלילים), אחר כך פותח את ההקלטה הראשונה ב-tab רקעי, לוחץ Play, מקליט 20 שניות
6. Save As של `zoom-network-debug_<date>.json`
7. **שלח אלי**

### מה אני אחפש ב-JSON

ב-`results[0].classification`:

- **`videoCandidates`** ארוך וכל item הוא mp4 → **MP4 ישיר**, קל יחסית. Phase 1 ייקח 4-6 שעות.
- **`hlsManifests`** קיים → **HLS**. צריך להוריד manifest + לפענח segments. Phase 1 ייקח 10-15 שעות.
- **`mseActivity`** ארוך + הרבה appendBuffer → **MSE/HLS וודאי**. הכי מסובך.
- **כלום מהאלה אבל הוידאו ניגן** → DRM / MediaSource מוצפן. הפיצ'ר לא ישים.

ה-`playClicked` יראה לי איזה selector תפס את כפתור ה-Play (אם בכלל). אם null — לא הצלחתי ללחוץ ולכן הוידאו לא ניגן. אצטרך לעדכן את הסלקטורים.

---

## v1.22.2 — meyda detour מושהה (השרת שבור, לא הקוד)

המשתמש הריץ ניסיון שלישי. הפעם debug snapshot חשף משהו מכריע:

```json
"bodyTextLen": 16,            // Angular בקושי טען (פעם קודמת 356)
"buttonCandidates": [],       // אין יותר כפתור "הדפס"
"all": [
  "...Languages/he.*.json",   // bundle של תרגומים
  "google-analytics.com/g/collect"  // רק tracking
]                              // אפס API calls לסילבוס
```

האנגולר מבקש תרגומים, מדווח לאנליטיקה — ועוצר. אין שום בקשה ל-PDF, אין כפתור, אין כלום.

**המשתמש אישר שגם בדפדפן רגיל, כשנכנסים ל-URL של meyda, לוחצים "הדפס", מקבלים "הורדה נכשלה".** זה אומר ש-meyda עצמו לא מגיש את הסילבוס כרגע — תקלת שרת/backend, לא בעיית קוד שלנו.

**הפעולה:** הוספתי הגדרה `tryMeydaSyllabusDetour` שמכבה את כל ה-detour של v1.22.0/v1.22.1 כברירת מחדל (false). הקוד נשאר במקום (`fetchMeydaSyllabus`, helpers, `isMeydaSyllabus`) — מוכן להפעלה מחדש כש-meyda יחזור לעבוד. עד אז:

- סילבוס יורד כ-link ב-`links.txt` (התנהגות שלפני v1.22)
- אין יותר 11 שניות המתנה לכל סילבוס
- ה-`_url-debug.json` עדיין נוצר אם משהו אחר מסוג URL נכשל — לא קשור ל-meyda

**איך להפעיל מחדש כשmeyda יחזור לעבוד:** פתח את ה-popup → ⚙ הגדרות → תפריט הגדרות. (אין UI לטוגל הזה — נוסיף אחד כשנדע ש-meyda חזרה. אז אפשר לשנות זמנית דרך `chrome.storage.local.set({ settings: { ...s, tryMeydaSyllabusDetour: true } })` ב-DevTools, אבל בערך, פשוט תפנה אלי באותו רגע.)

**הקריאה ל-meyda IT:** אם אתה לומד באריאל ויש לך מי לפנות אליו ב-IT — אולי שווה לדווח שהפורטל מחזיר אנגולר שלם בלי תוכן ושלוחצי "הדפס" מחזירים "הורדה נכשלה". המידע ב-SESSION-NEXT.md.

---

## v1.22.1 — meyda: לחיצה אוטומטית על "הדפס" + סינון junk

**הבעיה ב-v1.22.0:** ה-snapshot החדש חשף שתיים:
1. `networkCaptured: []` ו-`anchorCandidates: []` — meyda לא טוען את ה-PDF אוטומטית כשנכנסים ל-URL. דרושה לחיצה על כפתור.
2. ה-iframe היחיד היה `https://www.google.com/recaptcha/api2/anchor?...` — והקוד שלי ניסה fetch אליו, חטף CORS error מגוגל.
3. אבל היה גם: `buttonCandidates: ["הדפס"]` — הכפתור שצריך ללחוץ.

**הפתרון:**

### 1. לחיצה אוטומטית

ב-`fetchMeydaSyllabus` יש עכשיו שני שלבים:
- **Phase A:** המתנה של 5 שניות, snapshot. אם יש candidates → ננסה אותם.
- **Phase B (חדש):** אם Phase A החזיר 0 candidates, מחפש כפתור עם `^(הדפס|הורד|print|download)$` (exact match) או fallback ל-contains. לוחץ עליו דרך `el.click()`. ממתין 6 שניות נוספות. snapshot חדש.

### 2. Monkey-patch מורחב

- **`window.open`** — כש-Angular פותח PDF בטאב חדש, ה-URL נתפס לפני שהטאב נפתח.
- **`window.print`** — אם meyda משתמש ב-`window.print()` במקום fetch, נדע שצריך אסטרטגיה אחרת. נסמן ב-`meydaPrintCalled: true` ב-trace.
- **כל ה-fetch + XHR** — בלי הסינון המוקדם של "file-like". כל URL נשמר, סינון בפוסט-פרוסס.

### 3. סינון junk

`_isMeydaCandidateJunk` דוחה: reCAPTCHA, Google fonts/analytics/maps, YouTube, Facebook, hotjar, וכו'. אם ה-URL לא http/https — דחוי. **לא** ננסה fetch לדומיינים האלה — חוסך CORS errors.

### 4. עדיפויות candidates

`_buildMeydaCandidates` בונה רשימה ממוינת:
1. Network entries עם content-type קובץ
2. `window.open` URLs
3. iframe/embed/object/pdfDataUrl
4. Anchor candidates
5. Last-resort: כל URL מ-meyda/ariel שלא נראה כמו static asset

הראשון שמחזיר file response בעת fetch — מנצח.

**מה לבדוק:** הריץ שוב את אותו הקורס (חיישנים). אמור לראות hash של trace חדש ב-`_url-debug.json`:
- `meydaSnapshotInitial` — לפני הלחיצה
- `meydaClick: { clicked: true, text: "הדפס" }` — אם נלחץ בהצלחה
- `meydaSnapshotAfterClick` — אחרי הלחיצה (אמור להכיל את ה-PDF ב-`all`)
- `meydaPrintCalled: true` — אם meyda השתמש ב-window.print (כש זה קורה, נדע שצריך אסטרטגיה אחרת)
- `meydaResolvedUrl` — אם הצלחנו לחלץ את ה-PDF, ה-URL ממנו הורדתי

---

## v1.22.0 — תיקון סילבוס meyda (Angular SPA detour)

**הקשר:** v1.21.1 הוסיף debug trace. המשתמש הריץ והעביר את הקובץ — הוא חשף שמייה הוא **Angular SPA**: HTML של 1397 בתים בלבד עם `<app></app>` ריק ושתי tags של `<script type="module">`. ה-PDF נטען רק אחרי שה-JS רץ ובונה את העמוד דינמית. `candidates: []` היה ריק כי הסלקטורים שלי רצו על ה-static HTML שאין בו כלום.

**הפתרון:** Detour של "Step 3.5" ב-`fetchUrlActivity`. כש-`external URL` תואם תבנית meyda syllabus (`meyda.ariel.ac.il/Portals/*/show-syllabus/<id>`):

1. **פותח tab רקעי** עם ה-URL — Chrome יריץ את ה-Angular SPA כרגיל.
2. **מזריק network monitor** ב-`world: 'MAIN'` שעוקב אחרי **fetch + XHR**. כל request עם content-type של `pdf` / `octet-stream` / Office / או URL שמכיל `.pdf` נשמר ב-`window.__mhMeydaCaptured`.
3. **ממתין 8 שניות** — מספיק זמן ל-Angular לבוט + auth + לטעון את ה-PDF.
4. **תופס snapshot** של:
   - רשימת ה-requests שתועדה (`networkCaptured`)
   - `<iframe src>`, `<embed src>`, `<object data>` ב-DOM
   - data-attributes שמרמזות PDF (`data-pdf-url`, `data-src`)
   - anchors שמכילים `download`/`pdf`/`syllabus`/`הורד`/`הדפס` (עד 20)
   - לוג של כפתורים רלוונטיים (לחיזוי עתידי — לא נלחצים עדיין)
5. **בונה רשימת candidates** ממוינת לפי עדיפות (network קודם — כבר אומת שזה קובץ, ואז DOM).
6. **מנסה fetch לכל candidate** עם credentials. הראשון שמחזיר file response → נשמר ל-ZIP.
7. **סוגר את ה-tab.**

אם meyda עדיין נכשל, הזרימה נופלת בחזרה ללוגיקה הסטנדרטית (הניחוש ב-static HTML — שתמיד יחזור ריק עבור meyda, אבל לפחות לא חוסם).

**יתרון נוסף:** ה-`meydaSnapshot` נשמר ב-`_url-debug.json` גם כשהפעולה הצליחה — אם בעתיד meyda ישתנה, יהיה לנו snapshot להסתכל עליו.

**איך לבחון:**
1. סרוק קורס עם סילבוס meyda (חיישנים — אותו אחד מה-debug)
2. לחץ "הורד" — תראה ב-status שורה שאומרת שזה רץ ב-bg tab (יקח ~10 שניות נוספות לסילבוס)
3. ב-ZIP אמור להופיע `סילבוס.pdf` (או שם אחר אם meyda נותן אחר ב-Content-Disposition)
4. אם עדיין יורד כ-link → פתח את `_url-debug.json`, חפש `meydaSnapshot`, ושלח אלי. אז אחזה מה לא תפסתי.

---

## v1.21.2 — tx-stamped תמלילים + לוגים לאבחון scan

**שני שינויים:**

### תמלילים: timestamp בכל שורה

המשתמש הסביר: "VTT קשה להתמודד איתו, רוצה רק טקסט עם timestamps, אם ארצה VTT אדאג להמיר בעצמי". מובן.

`vttToCleanText` נכתב מחדש:

**לפני:**
```
Oded Medina: בוקר מצוין. אני רק רוצה לדבר שנייה אחת על המאמר.
אני רק רוצה לוודא שזה זה.
```
(קיבוץ פסקאות לפי דובר, ללא timestamps)

**עכשיו:**
```
[00:00:04] Oded Medina: בוקר מצוין. אני רק רוצה לדבר שנייה אחת על המאמר.
[00:00:21] Oded Medina: אני רק רוצה לוודא שזה זה.
[00:00:34] Oded Medina: בסדר? זה לא, זה איזשהו משהו שכאילו היה גם שנה שעברה.
```

- שורה אחת לכל cue
- `[HH:MM:SS]` בתחילת השורה
- שם הדובר נשמר (מה שמופיע ב-VTT אחרי הזמן)
- בלי קיבוץ פסקאות (הזמן כבר מספק הפרדה טבעית)

מאחר וברירת המחדל היא `'txt'` (מ-v1.20.1), ה-`.txt` שיוצא ב-ZIP הוא הפורמט החדש. אין `.vtt` ב-ZIP כברירת מחדל. ה-VTT converter standalone גם משתמש בפונקציה החדשה.

### אבחון Scan שבור

המשתמש דיווח: "הסריקה בכלל לא עובדת נשבר ברגע שלוחצים עליו". אני לא מצאתי באף סקירת קוד שלי שום משהו ב-v1.21.0/v1.21.1 שצריך להשפיע על מסלול הסריקה.

הוספתי `console.error` מפורש ב-3 נקודות מפתח:
- bootstrap הפופאפ (loadCachedSettings, refreshQueueArea, auto-dashboard-scan)
- catch של scan handler

**הוראות אבחון:**
1. קליק ימני על אייקון התוסף → "בדוק" / Inspect
2. ב-DevTools שנפתח, גש ללשונית "Console"
3. סגור את ה-DevTools, פתח שוב את הפופאפ
4. (ה-DevTools נפתח שוב אוטומטית כי כבר היה inspect)
5. לחץ "סרוק"
6. תראה ב-Console שורה אדומה — `[Moodle Hoarder] Scan failed:` או similar
7. שלח לי את ההודעה המלאה + ה-stack trace

---

## v1.21.1 — URL debug sidecar (לחקירת בעיית הסילבוס)

**הקשר:** המשתמש דיווח שסילבוס לא מוריד — כתובת `https://meyda.ariel.ac.il/Portals/ex/show-syllabus/<id>` (תת-דומיין אריאל, אז `isAllowedHost` כן מאשר אותו) מגיעה כ-`{kind:'link'}` ל-links.txt במקום כקובץ. אני צריך לראות בדיוק מה meyda מחזיר כדי לכתוב handler מתאים.

**הפתרון לחקירה (לא לפתרון סופי עדיין):** `fetchUrlActivity` מוסיף instrumentation מלא. לכל URL activity שנכשל בהפיכה לקובץ:
- שלב 1 (mod/url) — finalUrl, status, headers, HTML snippet (≤80KB)
- שלב external — אותו דבר + רשימת **כל** ה-anchors / buttons / iframes / embeds שמצאתי בעמוד (עד 50, עם text + href + class)
- שלב download-candidate — אם מצאנו לינק שנראה כמו "download" / "print" / "syllabus" וכו', עוקבים אחריו וגם מתעדים
- `finalResult` — `link-on-fetch-error` / `link-no-external` / `link-host-not-allowed` / `link-no-download-found`

הכל נשמר ב-`_url-debug.json` בתוך ה-ZIP, **רק אם** יש כשלונות. אם הכל ירד כקבצים — אין debug file (חוסך מקום).

**שיפור נלווי:** הסלקטור של download candidates הורחב — קודם היה רק PDF/DOCX/syllabus/forcedownload/getfile, עכשיו גם `download`, `print`, `export` (לכיסוי דפוסים שלא ראינו עדיין).

**הוראה למשתמש:**
1. הורד קורס כרגיל עם הסילבוס מסומן
2. פתח את ה-ZIP, חפש `_url-debug.json`
3. שלח אלי את הקטע של ה-trace שמכיל "meyda" ב-`externalUrl`
4. אני אכתוב handler ספציפי לפי מה שאני רואה

**שים לב:** ה-debug file עלול לכלול קטעי HTML עם מידע אישי (שמך, מספר הקורס, ת"ז וכו' אם מופיעים בדף meyda). סקור לפני שאתה משתף.

---

## v1.21.0 — VTT → TXT converter standalone

**הבעיה לפני:** v1.20.1 הפך את ברירת המחדל ל-txt, אבל מה עם VTT שכבר יש לך — מהורדה קודמת, מ-Zoom ישיר, או מהורדות לפני שהפיצ'ר היה קיים? הקובץ הוא subtitle format עם cue numbers, timestamps והרבה רעש. אי אפשר פשוט לפתוח אותו ולקרוא.

**הפתרון:** כפתור standalone בפופאפ — "🔄 המר קובץ VTT לטקסט נקי". בוחר קובץ (או כמה ביחד), והתוסף מריץ את `vttToCleanText` הקיים — אותו ממיר שעובד על תמלילי Zoom שנלכדו דרך הזרימה — ומוריד `.txt` נקי לכל קובץ.

- מקבל גם `.vtt`, גם `.txt` עם WEBVTT header.
- בודק שיש WEBVTT header לפני שמתחיל — מסנן קבצים לא רלוונטיים.
- שם הפלט: `<שם הקובץ ללא .vtt>.txt` (משמר את השם המקורי).
- multiple selection — אפשר להמיר 30 קבצים בבת אחת.
- BOM נוסף כדי ש-Notepad של Windows יקרא עברית נכון.

**איך לבחון:** פתח את הפופאפ (בכל מקום — לא חייב Moodle). מתחת לכפתור הסריקה תראה את הכפתור החדש. בחר קובץ VTT שיש לך → מקבל TXT.

---

## v1.20.1 — ברירת מחדל txt בלבד לתמלילים

המשתמש העיר: "הקבצים של ה-VTT קשה להתמודד איתם בצורה ישירה". נכון. ה-VTT הוא subtitle format עם cue numbers, timestamps והרבה רעש שמיועד לנגן וידאו, לא לקריאה. ה-`vttToCleanText` כבר מייצר טקסט נקי טוב; אין סיבה לכפות גם את הקובץ הגולמי כברירת מחדל.

`transcriptFormats` הופך מ-`'both'` ל-`'txt'`. משתמש שיעדיף VTT (לסאבטייטלים על וידאו או כדי למקם בסוף משפט מסוים) — יבחר ידנית בהגדרות.

משתמשים קיימים שכבר שינו את ההגדרה — לא מושפעים (הערך השמור מנצח את ברירת המחדל).

---

## v1.20.0 — תמלילים: מקבילי + early-skip + טוגלים + שמות חכמים (Phase 2)

המשתמש דיווח שהפיצ'ר עובד מצוין על קורס שלם, וביקש 5 שיפורים. כולם כאן.

### 1. חילוץ במקביל

`extractZoomTranscripts` עכשיו מבוסס על worker pool במקום for-loop סדרתי.
- ברירת מחדל: **3 הקלטות בו-זמנית**.
- ניתן לשינוי בהגדרות (`transcriptConcurrency`, תחום 1-5).
- כל worker עובד על tab משלו → אין collision על `window.__mhVtt` (כל tab MAIN world משלו).
- חיסכון בזמן: 30 הקלטות בקצב 20 שניות = 10 דקות סדרתי → ~3:30 ב-3 במקביל.

### 2. דילוג מהיר אם אין תמליל

ב-Phase 1 חיכינו 25 שניות לכל הקלטה, גם לאלה שאין להן תמליל כלל. עכשיו:
- אחרי 8 שניות, אם לא תפסנו VTT ולא רואים שום סימן של UI לתמליל ב-DOM (`[class*="transcript"]`, `[data-test*="transcript"]`, `aria-label*="caption/transcript/CC"`, או `<track kind="captions">`) → מסיים מיד.
- בהקלטה עם UI לתמליל — חכים עד 22 שניות (hard timeout).
- חיסכון: הקלטה ללא תמליל = 12 שניות במקום 25.

### 3. טוגל פורמט

הגדרה חדשה `transcriptFormats`:
- **`both`** (ברירת מחדל) — גם `.vtt` (subtitle עם timestamps, יושב על וידאו) וגם `.txt` (נקי לקריאה עם דוברים).
- **`txt`** — רק `.txt` (הקטן ביותר, הכי נוח לקריאה).
- **`vtt`** — רק `.vtt` (אם רוצים סאבטייטלים, לא תמלילים לקריאה).

רדיו בהגדרות תחת "Zoom → פורמט תמלילים".

### 4. שם ZIP חכם

הקובץ נקרא לפי ה-topic הנפוץ של ההקלטות, לא יותר "zoom-recordings_*":

- אם ≥70% מההקלטות חולקות אותו topic (טיפוסי לקורס בודד) → **`<topic> הקלטות_<תאריך>.zip`** (למשל, "חיישנים הקלטות_2026-05-24.zip").
- אם topics מעורבים → fallback ל-"zoom-recordings_<תאריך>.zip".

### 5. שמות קבצים פנימיים מסודרים

עד עכשיו: `חיישנים_Mar_29__2026_10_02_AM.vtt` (תלוי בפורמט ש-Zoom החזיר).

עכשיו: `<topic>_<YYYY-MM-DD_HH-MM>.vtt` למשל **`חיישנים_2026-03-29_10-02.vtt`** — מסתדר טוב במיון אלפבתי לפי זמן.

פאלבק לסטרינג sanitised אם התאריך לא parseable.

### תיקונים נלווים

- `_status.txt` עכשיו מפריד בין "no-transcript-ui" (דילוג מהיר) לבין "timeout" (UI קיים אבל לא הגיע).
- הסטטוס בזמן ריצה אומר כמה במקביל כדי שלא תחשוב שתקוע.

---

## v1.19.0 — תמלילי Zoom 🎉 (Phase 1 — חילוץ אמיתי)

**הקשר:** v1.18.0 הכין מצב debug. המשתמש הריץ → ה-JSON שחזר חשף את הדפוס המדויק:
```
GET /rec/play/vtt?type=transcript&fid=<token>&action=play
Content-Type: txt;charset=UTF-8
Body: WEBVTT\r\n\r\n1\r\n00:00:04.418 --> ...
```
VTT 90KB עם עברית מלאה, מועבר כ-XHR, מגיע אוטומטית כשהנגן נטען (בלי לחיצת play). כל מה שנשאר זה לתפוס אותו ולהמיר.

**מה יש בגרסה הזו:**

### `extractZoomTranscripts(recordings, onProgress)`

לכל הקלטה:
1. פותח tab רקעי עם ה-share URL.
2. ממתין 3 שניות (Zoom עושה auth + redirect).
3. מזריק XHR + fetch monkey-patch ב-`world: 'MAIN'` שמחפש URL שמתאים ל-`/rec/play/vtt?...type=transcript`. כשתופס, שומר ב-`window.__mhVtt = { url, body }`.
4. polling כל 600ms עד 25 שניות. ברגע ש-`__mhVtt.body` קיים — מסיים.
5. סוגר את ה-tab.

מחזיר מערך של `{ recording, vtt?, vttUrl?, txt?, error? }`.

### `vttToCleanText(vtt)`

ממיר WebVTT לטקסט נקי:
- מסיר WEBVTT header, NOTE blocks, X-TIMESTAMP-MAP, STYLE, cue numbers, timestamps.
- מזהה "Speaker Name: text" prefix (עובד עברית + אנגלית).
- מקבץ שורות עוקבות של אותו דובר לפסקה אחת.
- פלט: `Speaker Name: text\n\nNextSpeaker: text\n\n...`

### זרימה משולבת

עד v1.18 — ה-Zoom flow הוריד txt עם URLs בלבד. עכשיו:
- אם `extractTranscripts: true` (ברירת מחדל) **ויש לפחות URL אחד שחולץ**: בונה **ZIP** שמכיל:
  - `הקלטות.txt` — רשימת הקישורים (תואם לפורמט הישן)
  - לכל הקלטה עם תמליל: `<topic>_<date>.vtt` + `<topic>_<date>.txt`
  - `_status.txt` — סיכום אילו הקלטות הצליחו/נכשלו, גדלי קבצים
  - הורדה כ-`zoom-recordings_<תאריך>.zip`
- אם כיבית את ההגדרה (`extractTranscripts: false`) — הזרימה הישנה בדיוק, txt בלבד.

### UI

- **הגדרה חדשה ב-options.html → סקציית "Zoom"**: "חילוץ תמלילים אוטומטי" (ברירת מחדל מסומן).
- ה-checkbox של debug capture בפיקר נשאר — אבל הניסוח שונה ל-"לפיתוח בלבד" כדי לא לבלבל. עדיין שימושי אם Zoom משנה את ה-API ונצטרך לחקור מחדש.

### מגבלות ידועות

- **איטי:** ~15-25 שניות לכל הקלטה. סדרתי (לא במקביל). 30 הקלטות = ~10 דקות. אפשר לשפר ל-2-3 במקביל בגרסה הבאה.
- **לא כל הקלטה יש תמליל:** מרצים שכיבו תמלול → תקבל `error` ב-`_status.txt` ולא יהיה קובץ עבור ההקלטה הזו. ה-ZIP עדיין יכלול את הקישורים והתמלילים שכן הצליחו.
- **fid token expiry:** ה-URL של ה-VTT מכיל JWT שתוקפו ~דקות. לכן חייבים לחלץ באותו session — לא לשמור URLs לכמה שעות ולנסות אחר כך.
- **Zoom auth:** מסתמך שאתה logged-in. אם עברו 24 שעות מ-login → fail.

### תודות

תודה למשתמש שהריץ את ה-debug capture של v1.18.0 ושלח את ה-JSON בזמן אמת — בלי זה הייתי צריך לנחש.

---

## v1.18.0 — תמלילי Zoom (Phase 0 — network debug)

**הקשר:** המשתמש ביקש פיצ'ר חדש — להוריד גם את התמלילים (transcripts) של ההרצאות מ-Zoom, נוסף ל-URLs הקיימים. אשר שיש לו אופציית "Audio Transcript" בנגן ה-Zoom של אריאל — כלומר הפיצ'ר זמין.

**איפה אנחנו בפיתוח:** לפני שאני נוגע בקוד ה-Zoom הקיים (שצוין במפורש כרגיש), אני צריך **לדעת בדיוק** איזה network request טוען את ה-VTT (WebVTT — פורמט תמלילי Zoom). הדפוס יכול להיות `/rec/transcript/...`, `/file/audio_transcript/...`, או דרך JWT query — תלוי בתצורת אריאל. במקום לנחש, מצאתי את הצורך לתלכוד תעבורת רשת אמיתית מהמשתמש.

**מה יש בגרסה הזו:** מצב Debug אופציונלי בלבד. checkbox חדש בפיקר ה-Zoom — `🔬 תלכוד network`. כשהוא מסומן:
1. הזרימה הקיימת רצה כרגיל (חילוץ URLs דרך monkey-patch על `window.open`) — **בלי שינוי**.
2. אחרי שהיא מסתיימת, הקוד החדש לוקח עד 5 מהקלטות שהצליחו ופותח כל אחת ב-tab רקעי (`chrome.tabs.create({ active: false })`).
3. מזריק לכל tab monkey-patch ל-`fetch` ו-`XMLHttpRequest` ב-`world: 'MAIN'` — תופס כל request עם URL, method, status, content-type, content-length, ו-snippet של עד 6KB מ-response (אם content-type/url נראים relevant: vtt/transcript/caption/subtitle/json/xml).
4. אחרי 15 שניות, snapshot של כל ה-requests + עוד meta על הדף (final URL, title, האם יש פאנל transcript ב-DOM, snippet של body).
5. סוגר את ה-tab.
6. מאגד הכל ל-`zoom-network-debug.json` עם schema v1 ומחייב Save As (כי הקובץ עלול להכיל JWT).

**מה הקובץ הזה ייתן לי:** הדפוס המדויק של ה-VTT request — URL pattern, headers, response shape. ברגע שאני יודע אותו, אני יכול לכתוב את ה-Phase 1: תלכוד ושמירה אוטומטית של התמליל בלי tab רקעי כל פעם.

**מה לא בוצע (כי דורש את תוצאות ה-debug):**
- חילוץ אמיתי של VTT
- המרת VTT → TXT נקי (פירוק cues, חיתוך timestamps)
- שמירת `transcript_<recording-id>.vtt` ו-`transcript_<recording-id>.txt` ב-ZIP
- טוגל קבוע בהגדרות

**סיכון:** הקוד החדש לחלוטין מבודד מהקוד הקיים של Zoom. רק שורה אחת בזרימה הקיימת בודקת `if (debugChk?.checked)`. אם המשתמש לא מסמן — שום דבר לא משתנה.

**איך להריץ:**
1. עבור לדף Zoom Recordings באריאל
2. סרוק → בחר 2-3 הקלטות
3. **סמן** את ה-checkbox `🔬 תלכוד network`
4. לחץ "פענח קישורים והורד"
5. הזרימה הרגילה תרוץ — tabs פתוחים, URLs נתפסים
6. אחר כך תפתח שוב כל URL ב-tab רקעי לתלכוד (אתה תראה אותם נסגרים אחרי 15 שניות כל אחד)
7. Save As של `zoom-network-debug_<תאריך>.json` — שלח אלי

---

## v1.17.0 — הרחבת i18n + JSON export (ROADMAP #72)

### הרחבת i18n לכל המחרוזות הדינמיות

**הבעיה לפני:** v1.16.0 כיסה את ה-HTML הסטטי (כותרות, כפתורים, placeholders), אבל כל ה-`setStatus`/`logLine`/error messages שנוצרו דינמית ב-JS נשארו עברית. משתמש שבחר English ראה כפתורים באנגלית אבל "סורק..." בעברית.

**הפתרון:**
- `t()` שודרג לתמיכה ב-`{var}` substitution: `t('status.error.with.message', { msg: e.message })`.
- כל ה-`setStatus` / `logLine` / `throw new Error` עם עברית הוחלפו לקריאות `t()`.
- `content_dashboard.js` (הסקריפט שמזריק כפתורי "הסתר" ב-`/my/`) קיבל לוקליזציה מלאה. הוסף ל-`content_scripts` במניפסט יחד עם `settings.js` ו-`i18n.js`.
- ב-init של ה-content script: טוען settings, פותר שפה (לפי `uiLanguage` או `<html lang>` של דף ה-Moodle), ומחיל לפני שהכפתורים מצורפים.
- תרגום נוסף: באנרי diff (checkpoint / "X פריטים חדשים מאז"), tooltip של chip מעל הסף, chip ה-"חדש"/"לא בדיפולט", confirm של ניקוי תור, notifications, tooltips של פינים.
- סה"כ ~50 מחרוזות נוספות תורגמו ל-en. הכיסוי כעת מלא (פרט לתוכן של קבצי ה-info.txt/links.txt בתוך ה-ZIP — נשארו עברית כי הם חלק ממבנה ה-ZIP יציב).

### JSON export — `course.json` בתוך ה-ZIP

**מה זה:** קובץ `course.json` חדש בתוך כל ZIP, עם dump מובנה של הקורס:
```json
{
  "schema": "moodle-hoarder.course.v1",
  "generator": "Moodle Hoarder",
  "generatorVersion": "1.17.0",
  "scannedAt": "2026-...",
  "course": { "id": "12345", "name": "...", "url": "..." },
  "counts": { "sections": 14, "items": 47, "links": 3, "recordings": 2, "events": 5, "errors": 0 },
  "sections": [{ "index": 0, "name": "...", "itemCount": 3, "items": [...] }],
  "links": [...],
  "recordings": [...],
  "events": [...],
  "errors": [...]
}
```
- כל item כולל: `id`, `type`, `name`, `url`, `sectionIdx`, `sectionName`, `sizeBytes` (מ-HEAD pre-scan כש-#19 פעיל; אחרת `null`).
- כל recording/link/event נכלל עם metadata מינימלי.
- ה-schema מסומן ב-version (`v1`) — אינטגרציות יכולות לזהות שינויים עתידיים.

**למה זה שווה:**
- אינטגרציה עם Notion/Anki/Sheets/Obsidian בלי לפרסר HTML.
- סקריפטים חיצוניים (Python/Node) יכולים להסתמך על structured data.
- diff ידני בין הורדות של אותו קורס לאורך זמן.
- ה-JSON קטן (~10-50KB) ולא כולל את ה-blobs עצמם — שיתוף בטוח לחלוטין.

**הגדרה חדשה:** `includeJson` — ברירת מחדל פעיל (toggle בעמוד ההגדרות תחת "תוכן").

---

## v1.16.0 — i18n + טוגל שפת ממשק (ROADMAP #16)

**הבעיה לפני:** הממשק היה בעברית קשיחה. סטודנט שמסתכל על קורס באנגלית, או משתמש שמעדיף ממשק באנגלית — לא קיבל בחירה. לא הייתה תשתית i18n בכלל.

**הפתרון:** מודול i18n חדש (`i18n.js`) עם דיקציונרי מחרוזות עברית/אנגלית, פונקציית `t(key)`, ופונקציית `applyLanguage(lang)` שעוברת על ה-DOM ומחליפה טקסט לפי `data-i18n` attributes.

- **הגדרה חדשה: `uiLanguage`** — `auto` / `he` / `en`. נמצאת בראש עמוד ההגדרות בסקציה חדשה "שפת ממשק".
- **`auto`**: בעת פתיחת הפופאפ, התוסף בודק את `<html lang>` של הטאב הפעיל ב-Moodle. אם זה `he`/`iw` → עברית. אם `en` → אנגלית. נופל ל-`navigator.language` ואז ל-עברית כברירת מחדל.
- **`he` / `en`**: כפיה ידנית בלי תלות בטאב הפעיל.
- **DOM bindings**:
  - `data-i18n="key"` על אלמנט → `textContent` יוחלף לפי המפתח.
  - `data-i18n-html="1"` בנוסף → `innerHTML` (למחרוזות עם תגיות `<code>` וכד׳).
  - `data-i18n-attr="placeholder:picker.search.placeholder"` → attribute spec.
- **כיוון טקסט (RTL/LTR)**: `applyLanguage` מעדכן `<html dir>` ל-`rtl` ב-עברית ול-`ltr` ב-אנגלית.
- **חי בעמוד ההגדרות**: שינוי שפה מחיל מיד את התרגום על העמוד עצמו (כמו הטוגל ל-theme).
- **כיסוי**: כותרות, כפתורים, ה-placeholder-ים העיקריים, סקציות עמוד ההגדרות, ושפת picker (~55 binding-ים). הודעות סטטוס דינמיות ו-log lines נשארו בעברית (יהיו ב-v1.16.x עתידי). פאנל הדדליינים, ה-content script של הדאשבורד וטקסטים פנימיים של שגיאות עדיין בעברית.

**איך לבחון:** הגדרות → "שפת ממשק" → "English" → לפתוח את הפופאפ → סרוק קורס → לראות "Scan", "All", "None", "Reset", "Download ZIP", וכן הלאה.

---

## v1.15.0 — HEAD pre-scan לגודל קובץ (ROADMAP #19)

**הבעיה לפני:** ההגדרה "סף גודל קובץ" הייתה קיימת, אבל הבדיקה רצה רק תוך כדי ההורדה. אם קובץ של 800MB היה מעל הסף — הוא היה כושל באמצע ה-download באופן מבלבל. המשתמש לא ידע מראש איזה פריט עלול להיות גדול, ולא יכל להחליט בשלב הבחירה.

**הפתרון:** סריקת HEAD מקבילית (concurrency=4) לכל פריט בקורס שהוא `resource` או `folder` (סוגי הקבצים שאפשר לדעת את גודלם בלי לפרסר HTML). הסריקה רצה ברקע אחרי שהפיקר מוצג, בלי לחסום את העיניים.

- **תוצאה ויזואלית:** ליד כל פריט מופיע chip עם הגודל ("12.4MB", "850KB"). פריטים מעל הסף → chip אדום + הסרת הסימון אוטומטית + className `oversized` שמעמעם את הטקסט. המשתמש עדיין יכול לסמן ידנית אם הוא רוצה להוריד בכל זאת.
- **אינדיקטור התקדמות:** שורה קטנה מעל הסקשנים — "בודק גדלי קבצים… 12/47" עם spinner. כשמסתיים — אם יש קבצים שעקפו את הסף, מופיע סיכום: "X קבצים מעל YMB סומנו באדום".
- **fallback ל-HEAD שנכשל:** חלק מ-Moodle setups חוסמים HEAD ומחזירים 405. במקרה כזה התוסף נופל ל-`GET` עם `Range: bytes=0-0` ושולף את הגודל מ-`Content-Range`. תקף לרוב המוחלט של ה-servers.
- **שמירה על הגודל בין renders:** הגודל נשמר על `item.estimatedSize` — חיפוש בפיקר או re-render לא יורה מחדש את ה-HEAD requests.
- **הוסר ה-throw mid-download:** הקוד הישן זרק שגיאה באמצע ההורדה אם הקובץ עבר את הסף. עכשיו זה לא דרוש — והוא גם פגע: משתמש שסימן ידנית קובץ אדום היה אמור להצליח להוריד, אבל ה-throw היה מבטל לו. ההגנה הועברה לחלוטין לפיקר.
- **מתי זה רץ:** רק כש-`maxFileSizeMB > 0`. ברירת המחדל היא 0, אז כל מי שלא הגדיר סף — לא משלם בכלל בקריאות HTTP נוספות.

**איך לבחון:** בהגדרות → "סף גודל קובץ (MB)" → להזין 50 → לפתוח קורס עם קובץ מצגת ענק → לראות chip אדום ליד המצגת.

---

## v1.12.1 (קרוב)

**תיקונים לעמוד דף הבית של מודל ולעמוד ההגדרות**

- **בעיה: CSP חוסם את הסקריפט inline של ה-theme.**  
  ב-MV3 ברירת המחדל היא `script-src 'self'` — שום `<script>` inline לא רץ. הסקריפט הזה הוצא לקובץ נפרד `theme-bootstrap.js` ונטען דרך `<script src=...>`. אין עוד דליפת שגיאה ל-`chrome://extensions`.

- **בעיה: "הצג מוסתרות" לא עבד והתאריכים לא נעלמו.**  
  הקוד הקודם השתמש ב-classes שלפעמים נגרשו ע"י React של מודל. הקוד נכתב מחדש להשתמש ב-inline styles (`element.style.setProperty('display', 'none', 'important')`) שלא יכולים להידרס ע"י class.  
  בנוסף, `getHidingTargets()` חדש מטפס לעוטף ועוקב גם אחרי הסיבלינג הקודם אם הוא נראה כמו תווית תאריך — כך מטלות שיש להן תאריך כסיבלינג נפרד גם נסתרות לגמרי.

- **בעיה: "בטל הכל" היה מהבהב + שאלת אישור מציקה.**  
  הוסר לחלוטין. למשתמש יש את כפתור ↺ ("החזר") על כל פריט במצב "הצג מוסתרות" — הוא מבטל בצורה סלקטיבית.

- **חדש: סריקה אוטומטית של דדליינים בעמוד `/my/`.**  
  פתיחת התוסף ב-`moodlearn.ariel.ac.il/my/` מתחילה את הסריקה מיד, בלי צורך ללחוץ על "סרוק". בעמודים אחרים (קורס בודד, רב-קורסי, Zoom) הסריקה נשארת ידנית.

- **חדש: לחיצה אוטומטית על "הצגת פעילויות נוספות".**  
  מודל מציג רק חלק מהמטלות עד שלוחצים על "פעילויות נוספות". התוסף לוחץ על הכפתור הזה אוטומטית עד 8 פעמים כדי לטעון את כל המטלות לפני הסריקה.

- **חדש: שמירת snapshot של דדליינים בכל סריקה.**  
  עד עכשיו השמירה הייתה רק על ייצוא ל-ICS. עכשיו כל סריקה שומרת, אז גם אם אתה לא מייצא — הסריקה הבאה תראה "חדש"/"עודכן" באופן תקין.

- **חדש: עזרה לעמוד הקורסים שלי.**  
  בעמוד הדדליינים מופיע בנר עזרה: 💡 כדי להוריד קבצים — עבור לדף "הקורסים שלי" וכפתור ישיר אליו.

- **חדש: סיווג "לא ידוע" לדדליינים בלי תאריך.**  
  קודם דדליינים בלי due timestamp סווגו כ"עתידיים". עכשיו הם מסומנים כ"unknown" וממוינים אחרונים.

---

## v1.12.0 — Theme + Dashboard deadlines

**מטרה:** ערכת נושא חיה (Light/Dark/Auto) ופאנל מטלות עם ייצוא ליומן.

- ערכת נושא: רדיו בהגדרות, מתחלף מיד (בלי טעינה מחדש). אינלייז סקריפט קטן בראש העמוד מחיל את ה-class לפני שה-CSS מתפרס — אז אין הבזק.
- פאנל "ממתין לביצוע" בעמוד `/my/`: סריקה, באדג'ים (באיחור / השבוע / חדש / עודכן), ייצוא ל-ICS לייבוא ל-Google/Outlook/Apple Calendar.
- חוצה את `hiddenDeadlines` של הdashboard content script כדי לא להציג מטלות שהמשתמש הסתיר.

---

## v1.11.1 — תיקוני כפתור הסתר

**הבעיות שתוקנו:**
1. תאריכים לא נעלמו עם המטלה ⟶ נוספה הליכה במעלה ה-DOM למצוא את הקונטיינר שעוטף גם את התאריך וגם את התוכן.
2. "הצג מוסתרות" לא עבד ⟶ אותו root cause.
3. עיצוב הכפתור: × עגול ⟶ כפתור כחול בסגנון Moodle עם הטקסט "הסתר" / "החזר".

---

## v1.11.0 — Theme toggle + context menu לפי הגדרות

- ערכת נושא: רדיו בהגדרות (Light/Dark/Auto), עם רענון מיידי דרך localStorage mirror כדי שלא יהיה הבזק.
- קליק ימני: התפריט בנוי דינמית לפי `rightClickBehavior`:
  - `immediate` → "הורד עם Moodle Hoarder"
  - `queue` → "הוסף לתור"
  - `ask` → שני הפריטים (הורד מיד + הוסף לתור)
- שינוי בהגדרות → התפריט נבנה מחדש מיד דרך `chrome.storage.onChanged` listener.

---

## v1.10.0 — הסתרת מטלות במודל

**הבעיה:** עמוד `/my/` מציג כל מטלה ב-"ממתין לביצוע" כולל מטלות שכבר הוגשו ונפתחו מחדש (למשל מילואים) — מסתיר את המטלות החשובות.

**הפתרון:** Content script חדש `content_dashboard.js` שמזריק כפתור × ליד כל מטלה. קליק → המטלה נשמרת ב-`chrome.storage.local` כמוסתרת ונעלמת מהדף. באנר עליון "X מטלות מוסתרות" עם כפתורי הצגה/ביטול. סנכרון בין טאבים דרך `chrome.storage.onChanged`.

---

## v1.9.0 — Zoom 5-8x מהיר + סילבוס אגרסיבי

**Zoom:** הזמן הדומיננטי בכל הקלטה היה 8 שניות של polling ל-URL שלעולם לא הופיע באופן פסיבי. עכשיו:
- `waitForDetailPage` ממתין שכפתור ה-play יופיע (~600ms), לא ל-URL.
- `clickPlayAndCaptureUrl` עושה race על קריאת `window.open` הראשונה במקום `setTimeout(2500)` קבוע.
- Polling intervals הודקו: 200ms במקום 400ms.

**סילבוס:** הקוד הישן ניסה רק "mod/url → external URL → file". סילבוס באריאל לעיתים עובר 1-2 הפניות נוספות. ארבע שכבות חדשות:
1. הורדה ישירה אם תגובת mod/url היא קובץ.
2. שליפת URL חיצוני מ-HTML (`urlworkaround`, `<meta refresh>`, `window.location`).
3. fetch של ה-URL החיצוני.
4. אם זה HTML — חיפוש קישור download בתוכו ומעקב רמה נוספת.

---

## v1.8.2 — תיקון סריקת "הקורסים שלי"

מודל 4.x טוען את כרטיסי הקורסים דרך JS אחרי טעינת ה-HTML הראשונה. `fetch()` חדש החזיר skeleton ריק. החלפנו לקריאת DOM חי מהטאב הפעיל דרך `chrome.scripting.executeScript`, עם polling להתייצבות.

---

## v1.8.1 — בדיקת קוד + הגנה על quota

לאחר audit מלא של v1.8.0, נמצאו 2 דברים לתיקון:
- `chrome.storage.local` quota הוא 10MB. checkpoint עם base64 של blob היה יכול להתפוצץ.
- הוספת `unlimitedStorage` permission.
- דילוג על cache לקבצים מעל 8MB (נשמר רק marker).
- try/catch סביב כתיבה ל-storage — לעולם לא קורס הורדה.

---

## v1.8.0 — דף הגדרות, חידוש, תור, diff, ציונים, היסטוריה

**שינוי הכי גדול מאז v1.0** — מבנה חדש לחלוטין:

- **דף הגדרות נפרד** (`options.html`): כל הטוגלים שם, לא בפופאפ. מבנה ZIP / Save As / נתיב הורדה / ציונים / סוגי קבצים / קליק-ימני.
- **חידוש הורדה כושלת:** checkpoints ב-`chrome.storage` לפי courseId. נסגר הפופאפ באמצע? בכניסה הבאה — מופיע בנר "נמצאה הורדה לא-גמורה" וההורדה ממשיכה משם בלי להוריד שוב מה שכבר יש.
- **תור קליק-ימני:** ב-3 מצבים: מיד / תור / שאל. badge על האייקון מראה כמה בתור. כפתור "הורד את התור כ-ZIP" בפופאפ.
- **Diff משופר:** "חדש" / "לא בדיפולט" במקום רק "חדש".
- **ייצוא ציונים:** scraping של Grader Report → `ציונים.csv`. כבוי בדיפולט (כדי שלא תשתף ציונים בטעות).
- **דשבורד היסטוריה:** טבלת קורסים שהורדת — תאריכים, ספירת פריטים, קישור פתיחה.
- **תיקוני באגים:** שמות סקשנים עם underscores מטורפים — `cleanText()` מסיר לחצני UI של מודל לפני קריאה. `sanitizeFilename` מסיר נקודות/רווחים בסוף (אחת הסיבות שחילוץ ZIP נכשל ב-Windows).

---

## v1.7.1 — Hebrew בקובצי ZIP + תיקון mojibake

- **בעיה:** Windows סירב לפתוח את ה-ZIP — "archive is invalid".  
  v1.6.0 הציב UTF-8 גם ב-LFH וגם ב-Extra Field — Windows לא אהב את הכפילות. עכשיו ASCII fallback ב-LFH (לא-ASCII → `_`), ו-UTF-8 רק ב-Extra Field 0x7075. בסגנון JSZip/7-Zip.
- **בעיה:** שמות עברית מהשרת נראו כ-mojibake (Ã¨ÃÃ¦...).  
  Moodle שולח בייטים של UTF-8 ב-`Content-Disposition` בלי לקודד דרך RFC 5987. HTTP headers מועברים כ-Latin-1, אז fetch מחזיר כל בייט כתו Latin-1. `fixMojibake()` מזהה את המצב ומפענח מחדש כ-UTF-8.

---

## v1.7.0 — הורדה מקבילית

`fetchItemsParallel`: pool של 5 workers שמושכים מ-queue. תוצאות נשמרות בסדר המקורי. ל-קורסים גדולים — פי 3-5 מהר יותר.

---

## v1.6.0 — שמות עברית + מבנה sections + בורר Zoom

- **שמות עברית ב-ZIP:** הוספת Info-ZIP Unicode Path Extra Field (0x7075). Windows Explorer מציג עברית נכון.
- **מבנה ZIP חדש:** במקום `assignments/`, `folders/` — תיקיות לפי סקשנים של מודל (`01 - מבוא/`, `02 - שיעור 1/`) + תיקייה שטוחה `00 - כל הקבצים/`.
- **בורר Zoom:** לאחר סריקה, רשימה עם checkboxes — בוחרים אילו הקלטות לפענח URL.
- מסטלות הגשה (`_הגשות שלי/`) מופרדות מחומר המטלה.

---

## v1.5.3 — Zoom resolution קדימה

עד עכשיו הזרימה הייתה אחורה (page N → page 1) דרך Previous, אבל הקליק על Previous נכשל בשקט. עכשיו: קליק ישיר על מספר העמוד (`.ant-pagination-item-N`), עם fallback ל-Next/Prev צעד אחד.

---

## v1.5.2 — קרופ אוטומטי ללוגו + click-and-capture של Zoom

- **לוגו:** ה-PNG המקור היה עם ~15% padding שחור. הקטנה ל-16px השאירה לוגו זעיר. עכשיו `generate-icons.ps1` סורק bounding box של פיקסלים שאינם שקופים/שחורים וחותך לפני הקטנה.
- **Zoom URL extraction:** דף ה-detail לא מכיל URL גלוי בכלל. ה-play button הוא `<span role="button">` עם React onClick שקורא ל-`window.open(...)`. הפתרון: `world: 'MAIN'` ב-`executeScript` כדי לעקוף את `window.open` של הדף עצמו → ללחוץ על כפתור play → לתפוס את ה-URL שזום מנסה לפתוח.

---

## v1.5.1 — לוגו חדש + dump HTML לדיבאג של Zoom

- לוגו חדש (יוצר ע"י המשתמש).
- כשאף URL לא נמצא בדף detail של Zoom, מורד גם `zoom-detail-debug.html` עם ה-HTML של הדף הראשון — לבדיקה ידנית.
- הרחבת זיהוי URL ב-detail page.

---

## v1.5.0 — Zoom URL resolution איטרציה 1

לאחר איסוף מטא-דאטה מכל העמודים: לחיצה תוכנתית על כל שורה, כניסה ל-detail, חיפוש URL פסיבי, ניווט אחורה.

---

## v1.4.0 — Zoom multi-page pagination + תיקון duration regex

- pagination אוטומטית של עמודים מרובים בדף ההקלטות.
- Dedup בין עמודים.
- תיקון regex של duration שלכד בטעות חלק מ-meeting ID ("3109 M").

---

## v1.3.1 — Zoom scraper שכתוב

עברנו מ-"מחפש `<a href>` עם /rec/share/" (תפס שורה אחת בלבד) ל-"סורק `<tr>` בטבלאות לפי תוכן" (Zoom meeting ID + תאריך). תפיסה של כל ההקלטות.

---

## v1.3.0 — איטרציה 1 של Zoom

הוספת זיהוי דפי `*.zoom.us` (כולל `applications.zoom.us/lti/rich`). פלט ראשון של `zoom-recordings.txt` עם 5 אסטרטגיות סריקה.

---

## v1.2.0 — פיצ'רים חדשים אחרי v1.0

- מבנה לפי סקשנים + פלאט "כל הקבצים".
- קליק-ימני "הורד עם Moodle Hoarder".
- ICS calendar export ממטלות.
- Light/Dark mode בפופאפ.

---

## v1.0–1.1 — בסיס

- סריקת קורס בודד + רב-קורסי.
- בורר עם checkboxes, חיפוש, סלקטים-חכמים.
- הורדה כ-ZIP store-only (ללא תלות חיצונית).
- תפריט קליק-ימני, נוטיפיקציות.
- diff mode ראשוני.
- לוגו ב-4 גדלים, dark mode אוטומטי.
