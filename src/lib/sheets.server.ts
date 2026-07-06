/**
 * Google Sheets writer. Server-only.
 * Writes delivery rows to a per-client spreadsheet, organized by monthly tabs (MM.YYYY).
 * Uses a hidden column H (_msg_id) on each monthly tab as the idempotency marker.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";

const HEADERS = ["תאריך", "תיאור", "הזמין", "הערות", "מחיר", 'סה"כ ללא מע"מ', 'סה"כ אחרי מע"מ', "_msg_id"];

export interface DeliveryRow {
  delivery_date: string; // YYYY-MM-DD
  description: string;
  contact_ordered_by: string | null;
  notes: string | null;
  price: number | null;
  /** When true, compute the VAT split columns. When false, mirror price (no VAT inflation). */
  vat_explicit?: boolean;
  /** Idempotency marker written into column H (_msg_id). */
  message_id?: string | null;
}

function authHeaders() {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.GOOGLE_SHEETS_API_KEY ?? process.env.GOOGLE_SHEETS_API_KEY_1;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY חסר");
  if (!connKey) throw new Error("Google Sheets לא מחובר (GOOGLE_SHEETS_API_KEY חסר)");
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
    "Content-Type": "application/json",
  };
}

async function gatewayFetch(
  path: string,
  init: RequestInit = {},
  opts?: { fast?: boolean },
): Promise<Response> {
  const url = `${GATEWAY_URL}${path}`;
  const fast = opts?.fast === true;
  const maxAttempts = fast ? 3 : 4;
  const capMs = fast ? 4000 : 15000;
  let resp: Response | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    resp = await fetch(url, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers || {}) },
    });
    if (resp.status !== 429 && resp.status !== 503) return resp;
    if (attempt === maxAttempts - 1) return resp;
    const retryAfterHeader = resp.headers.get("Retry-After");
    let waitMs: number;
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
      waitMs = Math.min(retryAfterSec * 1000, capMs);
    } else {
      const base = fast ? (attempt === 0 ? 1000 : 2000) : Math.pow(2, attempt + 1) * 1000; // fast: 1s,2s | default: 2s,4s,8s
      waitMs = Math.min(base + Math.floor(Math.random() * 500), capMs);
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return resp!;
}

/** Format Hebrew date as DD/MM/YYYY for display in sheet. */
function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

/** Return monthly tab name (MM.YYYY) derived from a YYYY-MM-DD delivery date. */
export function monthlyTabName(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(isoDate);
  if (!m) {
    // Fallback to Asia/Jerusalem "now"
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")!.value;
    const mo = parts.find((p) => p.type === "month")!.value;
    return `${mo}.${y}`;
  }
  return `${m[2]}.${m[1]}`;
}

/** Create the monthly tab (RTL) and write the header row. Returns the new sheetId, or null on benign "already exists" race. */
async function createMonthlyTab(
  spreadsheetId: string,
  title: string,
  fast?: boolean,
): Promise<number | null> {
  const addResp = await gatewayFetch(
    `/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: { title, rightToLeft: true },
            },
          },
        ],
      }),
    },
    { fast },
  );
  if (!addResp.ok) {
    const body = await addResp.text().catch(() => "");
    if (body.includes("already exists")) {
      // Race between two concurrent messages — the tab is there, let the caller proceed.
      return null;
    }
    throw new Error(`יצירת לשונית חודשית נכשלה ${addResp.status}: ${body.slice(0, 200)}`);
  }
  const data = await addResp.json();
  const newSheetId = Number(data?.replies?.[0]?.addSheet?.properties?.sheetId ?? 0);

  // Format the new tab: hide the _msg_id column (H) and make the
  // description column (B) wrap text + be wider so it doesn't overflow.
  // Column indices are 0-based: A=0 ... B=1 (description) ... H=7 (_msg_id).
  await gatewayFetch(
    `/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            // Hide column H (_msg_id) from view — data stays for idempotency.
            updateDimensionProperties: {
              range: { sheetId: newSheetId, dimension: "COLUMNS", startIndex: 7, endIndex: 8 },
              properties: { hiddenByUser: true },
              fields: "hiddenByUser",
            },
          },
          {
            // Widen the description column (B) to ~360px.
            updateDimensionProperties: {
              range: { sheetId: newSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
              properties: { pixelSize: 360 },
              fields: "pixelSize",
            },
          },
          {
            // Wrap text in the description column (B) so long text stays inside the cell.
            repeatCell: {
              range: { sheetId: newSheetId, startColumnIndex: 1, endColumnIndex: 2 },
              cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
              fields: "userEnteredFormat.wrapStrategy",
            },
          },
        ],
      }),
    },
    { fast },
  ).catch(() => {
    // Formatting is cosmetic — never fail the whole write because of it.
  });

  const range = `${title}!A1:H1`;
  const putResp = await gatewayFetch(
    `/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ range, majorDimension: "ROWS", values: [HEADERS] }),
    },
    { fast },
  );
  if (!putResp.ok) {
    const body = await putResp.text().catch(() => "");
    throw new Error(`כתיבת כותרות נכשלה ${putResp.status}: ${body.slice(0, 200)}`);
  }
  return newSheetId;
}

/** Create a new spreadsheet titled for the client. The first monthly tab is created lazily on append. */
export async function createSheetForClient(clientName: string): Promise<string> {
  const title = clientName.slice(0, 100);
  const resp = await gatewayFetch("/spreadsheets", {
    method: "POST",
    body: JSON.stringify({
      properties: { title, locale: "iw_IL" },
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
  /** Tab the row was written to (or would have been written to). */
  sheetName?: string;
  /** 1-based row number on that tab. */
  rowNumber?: number;
  /** True when the append was skipped because the message_id was already present. */
  duplicate?: boolean;
}

/** Parse a Sheets append response's updatedRange (e.g. "06.2026!A7:H7") into a row number. */
function parseRowNumber(updatedRange: string | undefined): number | undefined {
  if (!updatedRange) return undefined;
  const m = /![A-Z]+(\d+):[A-Z]+\d+$/.exec(updatedRange) ?? /![A-Z]+(\d+)$/.exec(updatedRange);
  return m ? Number(m[1]) : undefined;
}

export async function appendDeliveryToSheet(
  spreadsheetId: string,
  delivery: DeliveryRow,
  vatRate: number,
  checkDuplicate: boolean = false,
  fast?: boolean,
): Promise<SheetWriteResult> {
  try {
    if (!spreadsheetId || !spreadsheetId.trim()) {
      return { ok: false, error: "לא הוגדר מזהה גיליון" };
    }

    const tabName = monthlyTabName(delivery.delivery_date);

    // Optional idempotency scan (opt-in). Skipped by default to avoid an extra
    // read request against the Sheets per-minute quota.
    if (checkDuplicate && delivery.message_id) {
      const idResp = await gatewayFetch(
        `/spreadsheets/${spreadsheetId}/values/${tabName}!H:H`,
        { method: "GET" },
        { fast },
      );
      if (idResp.ok) {
        const idData = await idResp.json();
        const values = (idData?.values ?? []) as string[][];
        for (let i = 0; i < values.length; i++) {
          if ((values[i]?.[0] ?? "") === delivery.message_id) {
            return { ok: true, sheetName: tabName, rowNumber: i + 1, duplicate: true };
          }
        }
      }
      // If the read failed (e.g. brand-new tab, 404), fall through and append.
    }

    // Build the row.
    const hasPrice = delivery.price != null;
    const price = hasPrice ? delivery.price! : "";
    let beforeVat: number | string = "";
    let afterVat: number | string = "";
    if (hasPrice) {
      // price is always stored as NET; after-VAT is always net × (1 + vatRate).
      beforeVat = delivery.price!;
      afterVat = Number((delivery.price! * (1 + vatRate)).toFixed(2));
    }

    const row = [
      formatDate(delivery.delivery_date),
      delivery.description ?? "",
      delivery.contact_ordered_by ?? "",
      delivery.notes ?? "",
      price,
      beforeVat,
      afterVat,
      delivery.message_id ?? "",
    ];

    const doAppend = () =>
      gatewayFetch(
        `/spreadsheets/${spreadsheetId}/values/${tabName}!A:H:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: "POST",
          body: JSON.stringify({ range: `${tabName}!A:H`, majorDimension: "ROWS", values: [row] }),
        },
        { fast },
      );

    // Append-first: try appending directly. If the monthly tab does not exist
    // yet, Sheets returns 400 with "Unable to parse range" — then create the
    // tab and retry the append once.
    let appendResp = await doAppend();
    if (appendResp.status === 400) {
      const body = await appendResp.clone().text().catch(() => "");
      if (body.includes("Unable to parse range")) {
        const created = await createMonthlyTab(spreadsheetId, tabName, fast);
        if (created === null) {
          // Concurrent request created the tab and may still be writing headers.
          await new Promise((r) => setTimeout(r, 2000));
        }
        appendResp = await doAppend();
      }
    }


    if (!appendResp.ok) {
      const body = await appendResp.text().catch(() => "");
      let userMsg = `שגיאה ${appendResp.status}`;
      if (appendResp.status === 403) {
        userMsg = "אין הרשאת עריכה לגיליון. ודאי שהגיליון משותף עם חשבון Google המחובר.";
      } else if (appendResp.status === 404) {
        userMsg = "הגיליון לא נמצא. בדקי שמזהה הגיליון נכון.";
      } else if (appendResp.status === 429) {
        userMsg = "מכסת הבקשות ל-Google Sheets חרגה. נסי שוב בעוד דקה.";
      } else {
        userMsg = `${userMsg}: ${body.slice(0, 200)}`;
      }
      return { ok: false, error: userMsg, sheetName: tabName };
    }

    const appendJson = await appendResp.json().catch(() => ({}) as Record<string, unknown>);
    const updatedRange = (appendJson as { updates?: { updatedRange?: string } })?.updates?.updatedRange;
    return { ok: true, sheetName: tabName, rowNumber: parseRowNumber(updatedRange) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "שגיאה לא ידועה בכתיבה לגיליון";
    return { ok: false, error: msg };
  }
}
