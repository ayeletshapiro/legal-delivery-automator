## שינויים

### 1. מסך הודעות (`src/routes/_authenticated/messages.tsx`)
הסרת כפתור "עבד מחדש":
- ב‑`canProcess` להוסיף תנאי: רק הודעות בסטטוס שלא עובד עדיין יציגו כפתור (כלומר סטטוסים כמו `done`, `failed`, `missing_client`, `awaiting_clarification`, `cancelled`, `ignored` — לא יציגו כפתור כלל).
- הסרת הענף `isReprocess(...)` והאייקון `RotateCcw` מהקוד ומהייבוא. הכפתור שנשאר הוא רק "עבד" (Play).
- אם בעקבות זה אין יותר שורות שמציגות פעולה — להשאיר את העמודה "פעולה" בטבלה (תהיה ריקה לעיתים, אבל זה תקין).

### 2. מסך שליחויות (`src/routes/_authenticated/deliveries.tsx`)
הסרה מלאה של עריכה ומחיקה מה‑UI:
- הסרת עמודת "פעולות" מטבלת הדסקטופ + כל ה‑`Button` של עריכה/מחיקה.
- הסרת בלוק הכפתורים בתחתית כרטיס המובייל.
- הסרת `EditDialog` (כל הקומפוננטה) ושימושיה.
- הסרת `AlertDialog` למחיקה.
- הסרת ה‑state: `editing`, `confirmDel`.
- הסרת ה‑mutations: `updMut`, `delMut`, יחד עם הייבואים של `updateDelivery`, `deleteDelivery`, `useMutation`, `useQueryClient`, `Dialog*`, `AlertDialog*`, `Textarea`, `Pencil`, `Trash2`, `toast` — אם לא בשימוש בשום מקום אחר בקובץ.

### השרת
- **לא** מוחקים את `updateDelivery` / `deleteDelivery` מ‑`src/lib/deliveries.functions.ts` — הם עדיין יכולים לשמש בעתיד או כ‑API. רק מסירים את הקריאות מה‑UI.

### בדיקות
- ודא ש‑typecheck/build עובר אחרי הסרת הייבואים שלא בשימוש.
- מסך הודעות: סטטוס `received` עם טקסט → רואים כפתור "עבד"; סטטוס `done`/`failed` → לא רואים כפתור.
- מסך שליחויות: אין יותר עמודת פעולות, אין דיאלוגים.