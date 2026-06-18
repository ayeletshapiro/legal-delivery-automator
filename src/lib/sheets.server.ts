/**
 * Google Sheets writer. Server-only.
 * Appends delivery rows to a client's spreadsheet via the Lovable connector gateway.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";

const HEADERS = [
  "תאריך",
  "תיאור",
  "הזמין",
  "הערות",
  "מחיר",
  'סה"כ ללא מע"מ',
  'סה"כ אחרי מע"מ',
];

const VAT_RATE = 0.18;

export interface DeliveryRow {
  delivery_date: string; // YYYY-MM-DD
  description: string;
  contact_ordered_by: string | null;
  notes: string | null;
  price: number | null;
}

function authHeaders() {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY חסר");
  if (!connKey) throw new Error("Google Sheets לא מחובר (GOOGLE_SHEETS_API_KEY חסר)");
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
    "Content-Type": "application/json",
  };
}

async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${GATEWAY_URL}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) },
  });
  return resp;
}

/** Format Hebrew date as DD/MM/YYYY for display in sheet. */
function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

/** Set the first sheet (sheetId=0) of a spreadsheet to right-to-left. */
async function setSheetRtl(spreadsheetId: string): Promise<void> {
  const resp = await gatewayFetch(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId: 0, rightToLeft: true },
            fields: "rightToLeft",
          },
        },
      ],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.warn(`setSheetRtl ${resp.status}: ${body.slice(0, 200)}`);
  }
}

/** Write headers to row 1 and switch sheet to RTL without a pre-read to avoid Sheets read quota. */
async function ensureHeaders(spreadsheetId: string): Promise<void> {
  const range = "A1:G1";
  const putResp = await gatewayFetch(
    `/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ range, majorDimension: "ROWS", values: [HEADERS] }),
    },
  );
  if (!putResp.ok) {
    const body = await putResp.text().catch(() => "");
    throw new Error(`כשל בכתיבת כותרות ${putResp.status}: ${body.slice(0, 300)}`);
  }

  await setSheetRtl(spreadsheetId);
}

/** Create a new spreadsheet titled for the client, RTL by default. Returns spreadsheetId. */
export async function createSheetForClient(clientName: string): Promise<string> {
  const title = clientName.slice(0, 100);
  const resp = await gatewayFetch("/spreadsheets", {
    method: "POST",
    body: JSON.stringify({
      properties: { title, locale: "iw_IL" },
      sheets: [
        { properties: { sheetId: 0, title: "שליחויות", rightToLeft: true } },
      ],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`כשל ביצירת גיליון ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  const sheetId = data?.spreadsheetId;
  if (!sheetId || typeof sheetId !== "string") {
    throw new Error("יצירת הגיליון הצליחה אך לא הוחזר מזהה");
  }
  return sheetId;
}

export interface SheetWriteResult {
  ok: boolean;
  error?: string;
}

export async function appendDeliveryToSheet(
  spreadsheetId: string,
  delivery: DeliveryRow,
): Promise<SheetWriteResult> {
  try {
    if (!spreadsheetId || !spreadsheetId.trim()) {
      return { ok: false, error: "לא הוגדר מזהה גיליון" };
    }

    await ensureHeaders(spreadsheetId);

    const hasPrice = delivery.price != null;
    const price = hasPrice ? delivery.price! : "";
    const totalBeforeVat = hasPrice ? delivery.price! : "";
    const totalAfterVat = hasPrice ? Number((delivery.price! * (1 + VAT_RATE)).toFixed(2)) : "";

    const row = [
      formatDate(delivery.delivery_date),
      delivery.description ?? "",
      delivery.contact_ordered_by ?? "",
      delivery.notes ?? "",
      price,
      totalBeforeVat,
      totalAfterVat,
    ];

    const appendResp = await gatewayFetch(
      `/spreadsheets/${spreadsheetId}/values/A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        body: JSON.stringify({ range: "A:G", majorDimension: "ROWS", values: [row] }),
      },
    );

    if (!appendResp.ok) {
      const body = await appendResp.text().catch(() => "");
      let userMsg = `שגיאה ${appendResp.status}`;
      if (appendResp.status === 403) {
        userMsg = "אין הרשאת עריכה לגיליון. ודאי שהגיליון משותף עם חשבון Google המחובר.";
      } else if (appendResp.status === 404) {
        userMsg = "הגיליון לא נמצא. בדקי שמזהה הגיליון נכון.";
      } else {
        userMsg = `${userMsg}: ${body.slice(0, 200)}`;
      }
      return { ok: false, error: userMsg };
    }

    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "שגיאה לא ידועה בכתיבה לגיליון";
    return { ok: false, error: msg };
  }
}
