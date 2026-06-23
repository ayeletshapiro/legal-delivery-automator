## מטרה
ניקוי כל נתוני הפעילות מהמערכת, תוך שמירה על נתוני המערכת עצמה (משתמשים, הרשאות, הגדרות, ולקוח ברירת המחדל "מזדמנים").

## מה יימחק
- `deliveries` (2 שורות) — כל המסירות
- `incoming_messages` (6) — כל ההודעות הנכנסות
- `outbound_messages` (0) — הודעות יוצאות
- `pending_clarifications` (0) — בירורים פתוחים
- `processing_errors` (4) — שגיאות עיבוד
- `client_aliases` (1) — כינויי לקוחות
- `clients` — כל הלקוחות שאינם `is_miscellaneous = true` (יישאר רק "מזדמנים")

## מה יישמר
- `profiles` — פרופילי משתמשים
- `user_roles` — תפקידים
- `app_config` — הגדרות גלובליות (כולל מע"מ)
- `clients` עם `is_miscellaneous = true` — לקוח ברירת המחדל "מזדמנים"
- `auth.users` — חשבונות התחברות

## סדר המחיקה (לכבוד foreign keys)
1. `pending_clarifications` → 2. `outbound_messages` → 3. `processing_errors` → 4. `deliveries` → 5. `incoming_messages` → 6. `client_aliases` → 7. `clients WHERE is_miscellaneous = false`

## הערה
שים לב: זו פעולה הפיכה רק דרך כפתור ה-Revert בצ'אט. לא תיווצר גיבוי אוטומטי לפני המחיקה. אם תרצה לשמור גם את ההודעות ההיסטוריות — אמור לי לפני האישור.
