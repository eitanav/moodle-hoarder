<div dir="rtl">

# עדכון בלחיצה — Native Host

תוסף Chrome **לא יכול לעדכן את הקבצים של עצמו** (מגבלת אבטחה). הרכיב הקטן הזה
מאפשר לכפתור "עדכן עכשיו" בתוך התוסף להריץ `git pull` ברקע, כך שתצטרך רק לרענן.

## התקנה (פעם אחת)

1. ודא ש-`git` ו-`python` מותקנים וב-PATH (אם השתמשת ב-transcriber — כבר יש לך).
2. הפעל דאבל-קליק על **`install.bat`** שבתיקייה הזו.
3. סגור ופתח מחדש את הדפדפן (כדי שיקלוט את ה-host).

זהו. מעכשיו, כשיש גרסה חדשה, בתוך התוסף:
**"⬇️ עדכן עכשיו"** → ואז **"🔄 רענן עכשיו"**. בלי לפתוח קבצים.

## איך זה עובד

- `install.bat` יוצר את `com.moodle_hoarder.updater.json` (Native Messaging Host
  manifest) עם הנתיב המוחלט, ורושם אותו ב-Registry של המשתמש (Chrome/Edge/Brave).
- `mh_updater.bat` → `mh_updater.py` הוא ה-host: מקבל הודעה מהתוסף ומריץ
  `git fetch` + `git reset --hard origin/main` בתיקיית התוסף.
- ה-host מורשה לדבר **רק** עם התוסף הספציפי (לפי ה-ID הקבוע
  `najfelnccehphphopjpgeomihocoinfk`).

## הסרה

דאבל-קליק על **`uninstall.bat`**.

## פרטיות ואבטחה

ה-host רץ מקומית, לא שולח כלום לאינטרנט מלבד אותו `git pull` מ-GitHub. הוא מקבל
רק שתי פקודות: `ping` ו-`update`. אין לו גישה לשום דבר מעבר להרצת git בתיקיית
התוסף.

</div>
