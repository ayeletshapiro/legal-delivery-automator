
# שלב 1 – תשתית האפליקציה (אישור סופי)

✅ **כבר רץ**: מסד הנתונים נבנה במלואו (כל 8 הטבלאות, enums, RLS, trigger אוטומטי לפרופיל + לקוח "מזדמנים", אדמין אוטומטי ל-`ayeletshapiro100@gmail.com`, מע"מ כ-0.18).

## מה אבנה כשתלחצי "Implement plan"

### דפי אימות (ציבוריים)
- `/auth` – התחברות/הרשמה (מייל+סיסמה, RTL עברי)
- `/reset-password` – איפוס סיסמה

### Layout ראשי
- `__root.tsx` – `dir="rtl"`, `lang="he"`, פונט Heebo (מ-Google Fonts דרך `<link>`)
- `_authenticated/route.tsx` – הגנה על כל מסכי הניהול (managed)
- `AppSidebar` עברי: דשבורד · לקוחות · כינויים · הודעות · שגיאות · הגדרות · יציאה

### מסכי ניהול (`/_authenticated/*`)
| מסך | תוכן |
|---|---|
| דשבורד | מונים: הודעות היום, שגיאות פתוחות, לקוחות פעילים, סה"כ משימות |
| לקוחות | הוספה/עריכה/ארכוב (לקוח עם היסטוריה לא נמחק, רק `is_archived=true`) |
| כינויים | הוספה/מחיקה לפי לקוח, ולידציית ייחודיות |
| הודעות | רשימה + סינון סטטוס + raw/transcribed + **כפתור "הוסף הודעת בדיקה" (פנימי בלבד, מאחורי auth)** |
| שגיאות | רשימה + "סמן כטופל" |
| הגדרות | עריכת מע"מ (UI: 18%, DB: 0.18) + עריכת מספר WhatsApp האישי |

### Server Functions (TanStack `createServerFn` + `requireSupabaseAuth`)
`src/lib/clients.functions.ts`, `aliases.functions.ts`, `messages.functions.ts`, `errors.functions.ts`, `config.functions.ts`, `profile.functions.ts`, `dashboard.functions.ts`, `test-message.functions.ts` (לכפתור הבדיקה – מאומת).

### Webhook ציבורי שלד – `POST /api/public/whatsapp-webhook`
- **אם `MAKE_WEBHOOK_SECRET` לא מוגדר ב-secrets → מחזיר מיידית `503` ולא מקבל בקשות.** ה-endpoint לעולם לא יהיה פתוח בלי secret.
- אם הסוד מוגדר: דורש `X-MAKE-SECRET` תואם (`timingSafeEqual`), אחרת `401`.
- ולידציית גוף עם Zod, מטפל בכפילויות (`whatsapp_message_id` unique), שומר בלבד עם `status='received'`. **אינו** קורא ל-AI/Sheets.
- אחרי הבנייה אבקש ממך להוסיף את הסוד `MAKE_WEBHOOK_SECRET` כדי שה-endpoint יהיה פעיל.

### מה לא נבנה עכשיו
WhatsApp/Make בפועל · OpenAI/Whisper · Google Sheets/Drive. שלבים נפרדים בעתיד.
