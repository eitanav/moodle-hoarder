# Claude Code Rules — Moodle Hoarder

## גרסאות וCHANGELOG — חובה

**בכל push משמעותי:**
1. להעלות גרסה ב-`manifest.json` (patch: 2.1.0 → 2.1.1, minor: 2.1.0 → 2.2.0, major: 2.x → 3.0.0)
2. להוסיף entry ל-`CHANGELOG.md` עם מה השתנה
3. לעדכן badge ב-`README.md`

**מתי להעלות:**
- patch — בגפיקס, תיקון קטן, שיפור קטן
- minor — פיצ'ר חדש, מיזוג PR משמעותי
- major — שינוי ארכיטקטורה גדול

**אסור:**
- לעשות push בלי להעלות גרסה
- להוסיף `version_name` עם RC/beta/alpha
- לעבוד על branch שאינו `main`

## ענפים

תמיד לעבוד על `main`. לא ליצור branches חדשים.

## מיזוג PRs

לפני מיזוג — לבדוק שאין חפיפה עם קוד קיים ב-main.
אחרי מיזוג — להעלות גרסה ולעדכן CHANGELOG.
