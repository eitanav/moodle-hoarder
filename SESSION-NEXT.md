# הנדאוף — לסשן הבא

## מצב אחרון (v1.22.2)

- ✅ תמלילי Zoom — Phase 2 עובד מצוין (parallel, early-skip, formats, smart naming, timestamped TXT)
- ✅ VTT → TXT converter standalone (כפתור בפופאפ)
- ✅ URL debug sidecar (`_url-debug.json` נוצר אוטומטית כשפריט url לא יורד)
- ⏸️ **סילבוס meyda — מושהה.** ראה למטה.

## הסילבוס: מה הולך עם meyda

### הבעיה

ה-URL של סילבוס הוא `https://meyda.ariel.ac.il/Portals/ex/show-syllabus/<id>`. החל מ-v1.22.0 ניסיתי להתמודד עם זה דרך bg tab + DOM scrape + click automation. שלושה debug captures מהמשתמש חשפו:

1. **HTML סטטי ריק** (1397 בתים, רק `<app></app>` + Angular bundles)
2. **Angular SPA לפעמים מרנדר ולפעמים לא** — בריצה אחת `bodyTextLen: 356` ויש כפתור "הדפס", בריצה אחרת `bodyTextLen: 16` ואין כלום
3. **meyda עצמו שבור גם ידנית** — המשתמש דיווח שגם בדפדפן רגיל, כשלוחצים "הדפס" באתר meyda, מקבלים "הורדה נכשלה"

### למה זה לא קוד שלי

הקוד עובד נכון: פותח tab, מזריק monitor, מחכה, scrape, מנסה fetch. כל השלבים מתועדים ב-trace. אבל אם meyda לא מגיש את ה-API call לסילבוס — אי אפשר לחלץ דבר שלא נשלח.

ב-debug 3 (v1.22.1) ראינו:
```json
"all": [
  "ClientApp/StaticFiles/Languages/he.*.json",   // bundle של תרגומים
  "https://www.google-analytics.com/g/collect...." // tracking
],
"bodyTextLen": 16,
"buttonCandidates": []
```

האנגולר טען, ביקש תרגומים, דיווח לאנליטיקה — ועצר. אין שום בקשת API לסילבוס.

### מה עשיתי ב-v1.22.2

- ה-detour כבוי בברירת המחדל: `tryMeydaSyllabusDetour: false`
- הקוד נשאר במקום (`fetchMeydaSyllabus`, `_meydaSnapshot`, `_buildMeydaCandidates`, `_isMeydaCandidateJunk`, `isMeydaSyllabus`) — מוכן להפעלה מחדש
- סילבוס חוזר להיות link ב-`links.txt` כמו פעם
- אין יותר 11 שניות המתנה לכל סילבוס

### מתי להפעיל מחדש

המשתמש מציע לבדוק:

1. **אם meyda חזר לעבוד ידנית** — הכנס ל-URL של סילבוס בדפדפן רגיל, חכה שייטען, לחץ "הדפס". אם ירד PDF → meyda חזר.
2. **אם אריאל הודיעו על תקלה** — לחפש email/SMS מ-IT של אריאל על תקלה בפורטל meyda.
3. **אם נסיון על קורס אחר עובד** — אולי הבעיה ספציפית לקורס "חיישנים" (syllabus id 247298) ולא לכל ה-meyda.

כש-meyda חוזר לעבוד — אפשר ל-`getSettings` ב-DevTools של options page ולעדכן `tryMeydaSyllabusDetour: true`, או לבנות לזה toggle ב-UI (5 דקות עבודה).

### אם meyda נשאר שבור לתמיד

יש מסלולים חלופיים — אבל כל אחד כרוך בלא-מעט עבודה:

1. **Bypass meyda לגמרי** — לבדוק אם יש endpoint רגיל באריאל שמספק סילבוסים. למשל `moodlearn.ariel.ac.il/local/syllabus/...` או דרך ה-API של Moodle. דורש מחקר על המבנה הפנימי של אריאל.
2. **Print → blob via window.print monkey-patch** — לתפוס את ה-iframe ש-Chrome מייצר לפני שהוא נשלח להדפסה. הזיהוי קיים (`meydaPrintCalled`), אבל לתפוס את התוכן עצמו דורש עבודה ניכרת.
3. **Drop כל מה שמ-meyda וביקש מהמשתמש לפתוח ידנית** — הסילבוס יהיה link בלבד, המשתמש פותח בדפדפן בעצמו. זה ההתנהגות הנוכחית עכשיו.

## משימות שמחכות

ראה גם CHANGELOG.md לפרטים מלאים.

- **#80 service worker downloads** — ראה MIGRATION-80.md. L בגודל. ה-checkpoint הקיים מטפל ב-80% מהבעיה.
- **#21 PDF renaming by title** — L, צריך pdf.js. נדחה.
- **שיפור תמלילים אפשרי** — חילוץ תמלילים גם כשמורידים קורס שלם, לא רק מתוך זרימת Zoom-LTI.

## כללי זהב לסשן הבא

- אל תיגע בקוד Zoom ה-resolver — שביר ועדין
- כן אפשר לגעת ב-`extractZoomTranscripts` / `fetchMeydaSyllabus` — קוד חדש שלי
- כל פיצ'ר חדש עם on/off → ב-options.html, לא בפופאפ
- CHANGELOG.md לכל גרסה, עם "הבעיה לפני / הפתרון / איך לבחון"
- שמירת bidirectional marks בעברית: `replace(/[‎‏‪-‮⁦-⁩﻿]/g, '')` לפני regex match
- Windows filename sanitisation: `sanitizeFilename()` תמיד
- **כשהשרת שבור — לא הקוד שבור.** אל תנסה לפצח שרת שלא מחזיר דאטה.
