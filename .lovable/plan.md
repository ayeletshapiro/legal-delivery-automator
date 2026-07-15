## הבעיה

כש-AI לא מזהה תאריך בהודעה, קוד יצירת השליחות (`src/lib/processing.server.ts` שורה 662) נופל בברירת מחדל ל-`israelToday()`. כשהרצנו מחדש היום את ההודעות שהיו תקועות ב-`missing_client`, כולן קיבלו את תאריך היום — למרות שההודעות המקוריות נשלחו בימים אחרים.

## התיקון

### 1. שינוי ברירת המחדל של `delivery_date` (`src/lib/processing.server.ts`)

במקום `israelToday()`, ניפול לתאריך של ההודעה הנכנסת עצמה (`incoming_messages.created_at`, מומר לאזור זמן ישראל → `YYYY-MM-DD`). ככה גם עיבוד רגיל וגם ריצה־מחדש עתידית ישמרו את התאריך הנכון של ההודעה, ולא את תאריך העיבוד.

- `parsed.delivery_date` תקין → נשתמש בו (המשתמש כתב תאריך מפורש).
- אחרת → תאריך יצירת ההודעה באזור זמן ישראל.
- Fallback אחרון (אם משום מה אין `created_at`) → `israelToday()`.

נחלץ את `created_at` מתוך ה-`msg` שכבר נטען בפונקציה (אם השדה לא נשלף כרגע, נוסיף אותו ל-`select`).

### 2. תיקון רטרואקטיבי של השליחויות שכבר נכתבו עם תאריך היום

נוסיף פונקציית שרת חדשה `backfillDeliveryDatesFromMessages` (ב-`src/lib/admin.functions.ts`, מוגנת ב-`requireSupabaseAuth` + בדיקת `has_role('admin')`) שעושה:

1. מוצאת שליחויות שנוצרו היום (`created_at::date = today`) שבהן `delivery_date = today` **ו**-ההודעה המקורית שלהן (`incoming_messages.created_at`) היא מיום אחר.
2. מעדכנת את `delivery_date` של כל אחת לתאריך של ההודעה המקורית (באזור זמן ישראל).
3. מסמנת מחדש `write_status='pending'` ומריצה שוב את הכתיבה לגיליון Google Sheets (דרך אותו נתיב שקיים ל-retry), כדי שהתאריך בגיליון יתעדכן.
4. מחזירה `{ scanned, updated, rewritten, failed, details }`.

### 3. כפתור UI לאדמין

באותו כרטיס אדמין ב-`src/routes/_authenticated/settings.tsx` (זה שכבר יש בו "הרץ מחדש הודעות חסרות לקוח") נוסיף כפתור שני: **"תקן תאריכי שליחויות מהריצה מחדש"**. הכפתור קורא ל-`backfillDeliveryDatesFromMessages` דרך `useServerFn` (כדי שהטוקן יצורף אוטומטית) ומציג סיכום `sonner` בסוף.

## נקודות טכניות

- אזור זמן: המרה עקבית עם `israelToday()` הקיים (Asia/Jerusalem) — נוסיף עוזר `israelDateOf(iso: string)` באותו קובץ.
- הפונקציה לא נוגעת בשליחויות שנקבע להן תאריך תקין ב-AI — רק בכאלה שנוצרו היום עם `delivery_date=today` שההודעה שלהן מיום אחר. מונע נזק לרשומות תקינות.
- לא נמחקות רשומות ולא נשלחות הודעות ללקוחות.
- אין שינוי בסכימת ה-DB.

## קבצים שיושפעו

- `src/lib/processing.server.ts` — שינוי ברירת המחדל של `deliveryDate`.
- `src/lib/admin.functions.ts` — פונקציה חדשה `backfillDeliveryDatesFromMessages`.
- `src/routes/_authenticated/settings.tsx` — כפתור אדמין נוסף.
