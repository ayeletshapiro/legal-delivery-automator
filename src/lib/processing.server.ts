/**
 * Core message-processing logic. Server-only.
 * Parses Hebrew WhatsApp text into a structured delivery and writes it.
 *
 * Accepts any Supabase client (admin from webhook, or per-user from server fn).
 * The client is responsible for RLS scoping (or bypassing) before calling.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { appendDeliveryToSheet, createSheetForClient } from "./sheets.server";
import { sendWhatsAppMessage } from "./twilio.server";

type DB = SupabaseClient<Database>;

/** Today as YYYY-MM-DD in Asia/Jerusalem (not UTC). */
function israelToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** Convert an ISO timestamp to YYYY-MM-DD in Asia/Jerusalem. Returns null if invalid. */
function israelDateOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${day}`;
}


/** Validate YYYY-MM-DD as a real calendar date. */
function isValidIsoDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Read VAT rate from app_config for the given user. Falls back to 0.18. */
async function loadVatRate(supabase: DB, userId: string): Promise<number> {
  const { data } = await supabase
    .from("app_config")
    .select("vat_rate")
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order("user_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return typeof data?.vat_rate === "number" ? data.vat_rate : 0.18;
}

function formatHebrewDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

async function sendConfirmationIfNeeded(
  supabase: DB,
  args: {
    toPhone: string;
    fromPhone?: string | null;
    userId: string;
    originalMessageId: string | null;
    clientName: string;
    deliveryDate: string;
    description: string;
    price: number | null;
  },
): Promise<void> {
  if (!args.originalMessageId) return;
  const { data: prior } = await supabase
    .from("outbound_messages")
    .select("id")
    .eq("incoming_message_id", args.originalMessageId)
    .eq("reply_type", "confirmation_success")
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();
  if (prior) return;

  const priceLine = args.price == null ? "מחיר: לא צוין" : `מחיר: ${args.price} ₪`;
  const body = [
    `נוספה שורה ללקוח: ${args.clientName}`,
    "",
    `תאריך: ${formatHebrewDate(args.deliveryDate)}`,
    `פירוט: ${args.description}`,
    priceLine,
    "",
    "השליחות נשמרה בהצלחה.",
  ].join("\n");

  await sendWhatsAppMessage(args.toPhone, body, {
    fromPhone: args.fromPhone,
    supabase,
    userId: args.userId,
    incomingMessageId: args.originalMessageId,
    replyType: "confirmation_success",
  });
}

interface ParsedDelivery {
  client_name: string | null;
  description: string;
  price: number | null;
  delivery_date: string | null;
  contact_ordered_by: string | null;
  notes: string | null;
  vat_explicit: boolean;
}

const SYSTEM_PROMPT = `You extract a single legal-document delivery task from a SHORT Hebrew WhatsApp message sent by an attorney/firm to a courier service.

Return STRICT JSON only, matching this schema:
{
  "client_name": string | null,         // The LAW FIRM / LAWYER that ORDERED the delivery. MUST be one of the KNOWN_CLIENTS names/aliases listed below (exact string), or null.
  "description": string,                // Short Hebrew description of WHAT to deliver and TO WHOM/WHERE.
  "price": number | null,               // See PRICE & VAT rules below. null if no price mentioned.
  "delivery_date": string | null,       // ISO date YYYY-MM-DD if mentioned. null = today.
  "contact_ordered_by": string | null,  // Name of the person who placed the order, if mentioned.
  "notes": string | null,               // Extra remarks. Append a VAT note when applicable (see below).
  "vat_explicit": boolean               // true only when the message explicitly stated before/after VAT. NOTE: informational only.
}

CRITICAL RULES:
- Output JSON only. No markdown, no commentary.
- ALWAYS extract description, price, and date even if client_name is null.
- description is REQUIRED, non-empty Hebrew text describing the delivery task itself.

CLIENT vs. CONTACT — MOST IMPORTANT:
- The word immediately after "עבור" or "בשביל" is the CLIENT → goes into "client_name".
- The word immediately after "הזמין" / "הזמינה" / "ביקש" / "ביקשה" is the ORDERING CONTACT → goes into "contact_ordered_by".
- NEVER put a name that follows "הזמין"/"הזמינה" into "client_name", even if that name is listed in KNOWN_CLIENTS as an alias of some other client. In that context the name refers to a person who works at the client from "עבור", not to the aliased client.
- Example: "…עבור גשר הזמין תהילה…" → client_name = "גשר", contact_ordered_by = "תהילה". Even if "תהילה" is a known alias, it is a person here.
- If no "עבור" appears and the message starts directly with a task ("היום מסירה…") without a firm name, client_name = null. A name inside "ל[X]" is the RECIPIENT, not the client.
- client_name MUST exactly match one of the KNOWN_CLIENTS names or aliases (case/whitespace as listed). If unsure, return null.

- Numbers in Hebrew words: "שמונים שקל"=80, "מאה"=100, "מאה וחמישים"=150, "מאתיים"=200, "חמישים"=50.
- Dates: "היום"=today, "מחר"=tomorrow. Use the provided "today" date as reference.

PRICE & VAT — VAT rate is 18%:
- DEFAULT (no VAT keyword): the price is the NET amount before VAT. Store the number as-is in "price". Set "vat_explicit"=false. Do NOT add a VAT note for this case.
- Message says price WITH VAT ("כולל מע\"מ", "אחרי מע\"מ", "ברוטו"): divide by 1.18, round to 2 decimals, set "vat_explicit"=true, and add a note like "מחיר בהודעה: 40₪ כולל מע\"מ".
- Message says price BEFORE VAT ("לפני מע\"מ", "בלי מע\"מ", "+מע\"מ", "פלוס מע\"מ", "נטו"): use as-is, set "vat_explicit"=true, and add a note like "מחיר בהודעה: 40₪ לפני מע\"מ".

EXAMPLES:
Input: "היום מסירה לעורך דין לוי בבני ברק, שמונים שקל"
Output: {"client_name": null, "description": "מסירה לעורך דין לוי בבני ברק", "price": 80, "delivery_date": null, "contact_ordered_by": null, "notes": null, "vat_explicit": false}

Input: "כהן ושות׳ — מחר מסירה לבית משפט השלום ת״א, 120 לפני מע\"מ"
Output: {"client_name": "כהן ושות׳", "description": "מסירה לבית משפט השלום ת״א", "price": 120, "delivery_date": null, "contact_ordered_by": null, "notes": "מחיר בהודעה: 120₪ לפני מע\"מ", "vat_explicit": true}

Input: "תשלום בדואר עבור גשר הזמין תהילה הערה 5 שח עמלה"
Output: {"client_name": "גשר", "description": "תשלום בדואר", "price": 5, "delivery_date": null, "contact_ordered_by": "תהילה", "notes": "עמלה", "vat_explicit": false}`;

export interface KnownClient {
  client_name: string;
  aliases: string[];
}

function formatKnownClients(known: KnownClient[]): string {
  if (!known.length) return "(none)";
  return known
    .map((k) => (k.aliases.length ? `- ${k.client_name} (כינויים: ${k.aliases.join(", ")})` : `- ${k.client_name}`))
    .join("\n");
}

async function callLovableAI(rawText: string, knownClients: KnownClient[]): Promise<ParsedDelivery> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const today = israelToday();
  const userPrompt = `today=${today}\n\nKNOWN_CLIENTS:\n${formatKnownClients(knownClients)}\n\nMESSAGE:\n${rawText}`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.AI_EXTRACTION_MODEL || "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`AI gateway ${resp.status}: ${body.slice(0, 200)}`);
  }
  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI returned empty content");
  const parsed = JSON.parse(content);

  return {
    client_name: parsed.client_name ?? null,
    description: String(parsed.description ?? "").trim() || rawText.trim(),
    price: typeof parsed.price === "number" ? parsed.price : null,
    delivery_date: parsed.delivery_date ?? null,
    contact_ordered_by: parsed.contact_ordered_by ?? null,
    notes: parsed.notes ?? null,
    vat_explicit: parsed.vat_explicit === true,
  };
}

export function normalize(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/["'״׳`]/g, "")
    .replace(/[,.;:!?()[\]{}<>/\\|+*=~"'–—\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(" ") : [];
}

/**
 * Trigger words that anchor client vs. contact roles in the message.
 * - "עבור" / "בשביל" → the CLIENT (law firm/lawyer that ordered).
 * - "הזמין" / "הזמינה" / "ביקש" / "ביקשה" → the ORDERING CONTACT (a person).
 */
const AVUR_TRIGGERS = new Set(["עבור", "בשביל"]);
const HIZMIN_TRIGGERS = new Set(["הזמין", "הזמינה", "ביקש", "ביקשה"]);
// Words that break the name capture window (either another trigger, a section
// marker, or a common Hebrew "content" word that clearly isn't a name).
const ANCHOR_STOP = new Set([
  ...AVUR_TRIGGERS,
  ...HIZMIN_TRIGGERS,
  "הערה",
  "הערות",
  "מחיר",
  "עמלה",
  "שח",
  "שקל",
  "שקלים",
  "היום",
  "מחר",
  "אתמול",
  "תשלום",
  "מסירה",
  "איסוף",
  "כולל",
  "לפני",
  "אחרי",
  "מעמ",
  "נטו",
  "ברוטו",
  "פלוס",
  "בלי",
]);

/**
 * Scan the (normalized) tokens for the words that come right after an
 * anchor trigger. Captures up to 3 tokens per trigger, stopping at the next
 * anchor/stop word or a numeric token.
 */
function extractAnchoredNames(rawText: string): { afterAvur: string[]; afterHizmin: string[] } {
  const tokens = tokenize(rawText);
  const afterAvur: string[] = [];
  const afterHizmin: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const target = AVUR_TRIGGERS.has(t) ? afterAvur : HIZMIN_TRIGGERS.has(t) ? afterHizmin : null;
    if (!target) continue;
    for (let j = i + 1; j < Math.min(i + 4, tokens.length); j++) {
      const nxt = tokens[j];
      if (!nxt || ANCHOR_STOP.has(nxt) || /^\d+$/.test(nxt)) break;
      target.push(nxt);
    }
  }
  return { afterAvur, afterHizmin };
}

/**
 * Resolve a client by AI-extracted name or by scanning the raw text for any
 * known client name / alias. On no match, returns { clientId: null, matched: false }.
 * The "מזדמנים" client is treated like any other client — no automatic fallback.
 */
async function resolveClientId(
  supabase: DB,
  userId: string,
  clientName: string | null,
  rawText: string,
): Promise<{ clientId: string | null; matched: boolean }> {
  const { data: aliases } = await supabase.from("client_aliases").select("client_id, alias").eq("user_id", userId);
  const { data: clients } = await supabase
    .from("clients")
    .select("id, client_name, is_archived")
    .eq("user_id", userId)
    .eq("is_archived", false);

  const activeClients = clients ?? [];
  const allAliases = aliases ?? [];

  const { afterAvur, afterHizmin } = extractAnchoredNames(rawText);
  const hizminMask = new Set(afterHizmin);

  const tryExactMatch = (candidate: string): string | null => {
    const norm = normalize(candidate);
    if (!norm) return null;
    const aliasHit = allAliases.find((a) => normalize(a.alias) === norm);
    if (aliasHit) return aliasHit.client_id;
    const nameHit = activeClients.find((c) => normalize(c.client_name) === norm);
    if (nameHit) return nameHit.id;
    return null;
  };

  // Step 0 — semantic anchor: the token(s) right after "עבור"/"בשביל" ARE the client.
  // Try longest-first (joined) then shorter suffixes, so multi-word firms still match.
  if (afterAvur.length > 0) {
    const attempts: string[] = [];
    for (let start = 0; start < afterAvur.length; start++) {
      for (let end = afterAvur.length; end > start; end--) {
        attempts.push(afterAvur.slice(start, end).join(" "));
      }
    }
    for (const cand of attempts) {
      const hit = tryExactMatch(cand);
      if (hit) return { clientId: hit, matched: true };
    }
  }

  // AI-extracted client_name — but ignore it if it is only present in the
  // message as an ordering-contact ("הזמין X"), otherwise it will hijack an
  // alias that belongs to a different client.
  if (clientName) {
    const norm = normalize(clientName);
    if (!hizminMask.has(norm)) {
      const hit = tryExactMatch(clientName);
      if (hit) return { clientId: hit, matched: true };
    }
  }

  // Build a token list of the raw message with the "הזמין X" tokens masked
  // out, so a contact name never counts as a client match in the fallbacks.
  const textTokenList = tokenize(rawText).filter((t) => !hizminMask.has(t));
  const textTokens = ` ${textTokenList.join(" ")} `;

  // Fallback 1: full alias or full client name appears in text
  const candidates = new Set<string>();
  for (const a of allAliases) {
    const p = tokenize(a.alias).join(" ");
    if (p && textTokens.includes(` ${p} `)) candidates.add(a.client_id);
  }
  for (const c of activeClients) {
    const p = tokenize(c.client_name).join(" ");
    if (p && textTokens.includes(` ${p} `)) candidates.add(c.id);
  }
  if (candidates.size === 1) {
    return { clientId: [...candidates][0], matched: true };
  }
  if (candidates.size > 1) {
    return { clientId: null, matched: false };
  }

  // Fallback 2: distinctive single-token match. For each significant token in
  // a client name/alias (len >= 3), if it appears in the message AND it maps to
  // exactly one client across all known names/aliases, treat as a unique hit.
  const tokenToClients = new Map<string, Set<string>>();
  const addTokens = (clientId: string, phrase: string) => {
    for (const tok of tokenize(phrase)) {
      if (tok.length < 3) continue;
      if (!tokenToClients.has(tok)) tokenToClients.set(tok, new Set());
      tokenToClients.get(tok)!.add(clientId);
    }
  };
  for (const c of activeClients) addTokens(c.id, c.client_name);
  for (const a of allAliases) addTokens(a.client_id, a.alias);

  const tokenCandidates = new Set<string>();
  for (const tok of textTokenList) {
    if (tok.length < 3) continue;
    const owners = tokenToClients.get(tok);
    if (owners && owners.size === 1) {
      tokenCandidates.add([...owners][0]);
    }
  }
  if (tokenCandidates.size === 1) {
    return { clientId: [...tokenCandidates][0], matched: true };
  }

  return { clientId: null, matched: false };
}

interface DeliverySheetWriteInput {
  deliveryId: string;
  messageId: string | null;
  userId: string;
  clientId: string;
  delivery_date: string;
  description: string;
  contact_ordered_by: string | null;
  notes: string | null;
  price: number | null;
  /** When true, scan column H first to avoid duplicating an already-written row. */
  checkDuplicate?: boolean;
  /** When true, use gatewayFetch's fast retry profile (webhook path with Twilio timeout). */
  fast?: boolean;
}

export async function writeDeliveryToClientSheet(
  supabase: DB,
  delivery: DeliverySheetWriteInput,
): Promise<{ writeStatus: string; writeError: string | null }> {
  let writeStatus: string = "pending";
  let writeError: string | null = null;
  let writtenSheetId: string | null = null;
  let writtenSheetName: string | null = null;
  let writtenRowNumber: number | null = null;

  try {
    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select("google_sheet_id, client_name")
      .eq("id", delivery.clientId)
      .maybeSingle();
    if (clientErr) throw clientErr;
    if (!clientRow) throw new Error("הלקוח המשויך למשלוח לא נמצא");

    let sheetId = clientRow.google_sheet_id?.trim() || null;
    if (!sheetId && clientRow.client_name) {
      sheetId = await createSheetForClient(clientRow.client_name);
      const { error: updateClientErr } = await supabase
        .from("clients")
        .update({ google_sheet_id: sheetId })
        .eq("id", delivery.clientId);
      if (updateClientErr) throw new Error(`שמירת מזהה הגיליון נכשלה: ${updateClientErr.message}`);
    }

    if (sheetId) {
      const { data: delRow, error: delRowErr } = await supabase
        .from("deliveries")
        .select("written_sheet_ids, vat_explicit")
        .eq("id", delivery.deliveryId)
        .maybeSingle();
      if (delRowErr) throw delRowErr;
      const already = (delRow?.written_sheet_ids ?? []) as string[];
      const vatExplicit = Boolean((delRow as Record<string, unknown> | null)?.vat_explicit);

      const vatRate = await loadVatRate(supabase, delivery.userId);

      if (already.includes(sheetId)) {
        writeStatus = "נכתב";
      } else {
        const result = await appendDeliveryToSheet(
          sheetId,
          {
            delivery_date: delivery.delivery_date,
            description: delivery.description,
            contact_ordered_by: delivery.contact_ordered_by,
            notes: delivery.notes,
            price: delivery.price,
            vat_explicit: vatExplicit,
            message_id: delivery.messageId,
          },
          vatRate,
          delivery.checkDuplicate === true,
          delivery.fast === true,
        );
        if (result.ok) {
          writeStatus = "נכתב";
          writtenSheetId = sheetId;
          writtenSheetName = result.sheetName ?? null;
          writtenRowNumber = result.rowNumber ?? null;
        } else {
          writeStatus = "שגיאה";
          writeError = result.error ?? "שגיאה לא ידועה";
        }
      }
    } else {
      writeStatus = "ללא גיליון";
    }
  } catch (createOrWriteErr: unknown) {
    writeStatus = "שגיאה";
    writeError = createOrWriteErr instanceof Error ? createOrWriteErr.message : "שגיאה לא ידועה ביצירת/כתיבת גיליון";
  }

  let newWrittenSheetIds: string[] | null = null;
  if (writtenSheetId) {
    const { data: cur } = await supabase
      .from("deliveries")
      .select("written_sheet_ids")
      .eq("id", delivery.deliveryId)
      .maybeSingle();
    const existing = ((cur?.written_sheet_ids ?? []) as string[]).filter((s) => s !== writtenSheetId);
    newWrittenSheetIds = [...existing, writtenSheetId];
  }
  const { error: updateDeliveryErr } = await supabase
    .from("deliveries")
    .update({
      write_status: writeStatus,
      write_error: writeError,
      written_at: writeStatus === "נכתב" ? new Date().toISOString() : null,
      ...(newWrittenSheetIds ? { written_sheet_ids: newWrittenSheetIds } : {}),
      ...(writtenSheetName ? { sheet_name: writtenSheetName } : {}),
      ...(writtenRowNumber ? { row_number: writtenRowNumber } : {}),
    })
    .eq("id", delivery.deliveryId);
  if (updateDeliveryErr) throw updateDeliveryErr;

  if (writeStatus === "נכתב" && delivery.messageId) {
    try {
      await supabase
        .from("processing_errors")
        .update({ resolved_at: new Date().toISOString() })
        .eq("message_id", delivery.messageId)
        .eq("error_type", "sheet_write_failed")
        .is("resolved_at", null);
    } catch {
      // best-effort
    }
  }

  if (writeStatus === "שגיאה" && writeError && delivery.messageId) {
    await supabase.from("processing_errors").insert({
      message_id: delivery.messageId,
      user_id: delivery.userId,
      error_type: "sheet_write_failed",
      error_description: `כשל בכתיבה לגיליון: ${writeError}`,
    });
  }

  return { writeStatus, writeError };
}


export interface ProcessResult {
  ok: boolean;
  status: "done" | "missing_client" | "missing_details" | "failed";
  deliveryId?: string;
  errorMessage?: string;
}

export async function processIncomingMessage(
  supabase: DB,
  messageId: string,
  businessPhone?: string | null,
): Promise<ProcessResult> {
  const { data: msg, error: msgErr } = await supabase
    .from("incoming_messages")
    .select("*")
    .eq("id", messageId)
    .maybeSingle();
  if (msgErr) throw msgErr;
  if (!msg) throw new Error("הודעה לא נמצאה");

  if (!msg.user_id) {
    const reason = "המשתמש לא מזוהה (מספר ה-WhatsApp של השולח לא מוגדר בפרופיל)";
    await supabase
      .from("incoming_messages")
      .update({
        status: "failed",
        error_detail: reason,
        processed_at: new Date().toISOString(),
      })
      .eq("id", messageId);
    return { ok: false, status: "failed", errorMessage: reason };
  }

  const text = (msg.transcribed_text || msg.raw_text || "").trim();
  if (!text) {
    const reason = "אין טקסט לעיבוד";
    await supabase
      .from("incoming_messages")
      .update({
        status: "missing_details",
        error_detail: reason,
        processed_at: new Date().toISOString(),
      })
      .eq("id", messageId);
    await supabase.from("processing_errors").insert({
      message_id: messageId,
      user_id: msg.user_id,
      error_type: "missing_details",
      error_description: reason,
    });
    return { ok: false, status: "missing_details", errorMessage: reason };
  }

  await supabase.from("incoming_messages").update({ status: "processing" }).eq("id", messageId);

  // Attachment note: surface image/document attachments in the sheet's notes column.
  const attachmentNote =
    msg.media_received && msg.message_type === "image"
      ? "תמונה מצורפת"
      : msg.media_received && msg.message_type === "document"
        ? "מסמך מצורף"
        : null;
  const mergeNotes = (n: string | null): string | null => {
    const base = (n ?? "").trim();
    if (!attachmentNote) return base || null;
    if (!base) return attachmentNote;
    return `${base} · ${attachmentNote}`;
  };

  try {
    // Load KNOWN_CLIENTS once (name + aliases) so the AI can pick an exact
    // client_name and so we can pass a stable rawText to the resolver.
    const [{ data: clientsRows }, { data: aliasRows }] = await Promise.all([
      supabase
        .from("clients")
        .select("id, client_name")
        .eq("user_id", msg.user_id)
        .eq("is_archived", false),
      supabase
        .from("client_aliases")
        .select("client_id, alias")
        .eq("user_id", msg.user_id),
    ]);
    const aliasesByClient = new Map<string, string[]>();
    for (const a of aliasRows ?? []) {
      if (!aliasesByClient.has(a.client_id)) aliasesByClient.set(a.client_id, []);
      aliasesByClient.get(a.client_id)!.push(a.alias);
    }
    const knownClients = (clientsRows ?? []).map((c) => ({
      client_name: c.client_name,
      aliases: aliasesByClient.get(c.id) ?? [],
    }));

    const parsed = await callLovableAI(text, knownClients);
    const { clientId, matched } = await resolveClientId(supabase, msg.user_id, parsed.client_name, text);

    // No client identified → fail the message, ask the user to resend with a client name.
    if (!matched || !clientId) {
      const reason = "לא זוהה שם לקוח בהודעה";
      await supabase
        .from("incoming_messages")
        .update({
          status: "missing_client",
          error_detail: reason,
          processed_at: new Date().toISOString(),
        })
        .eq("id", messageId);
      await supabase.from("processing_errors").insert({
        message_id: messageId,
        user_id: msg.user_id,
        error_type: "missing_client",
        error_description: reason,
      });
      if (msg.sender_phone) {
        await sendWhatsAppMessage(
          msg.sender_phone,
          "❗ ההודעה לא נקלטה — לא זוהה שם לקוח. אנא שלח את ההודעה שוב כולל שם הלקוח .",
          {
            fromPhone: businessPhone,
            supabase,
            userId: msg.user_id,
            incomingMessageId: messageId,
            replyType: "missing_client",
          },
        );
      }
      return { ok: true, status: "missing_client" };
    }

    const deliveryDate = isValidIsoDate(parsed.delivery_date)
      ? parsed.delivery_date
      : israelDateOf(msg.created_at) ?? israelToday();

    const { data: existingDelivery, error: existingErr } = await supabase
      .from("deliveries")
      .select(
        "id, message_id, user_id, client_id, delivery_date, description, contact_ordered_by, notes, price, write_status",
      )
      .eq("message_id", messageId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingErr) throw existingErr;

    if (existingDelivery) {
      const clientChanged = existingDelivery.client_id !== clientId;
      if (clientChanged) {
        const { error: reassignErr } = await supabase
          .from("deliveries")
          .update({
            client_id: clientId,
            write_status: "pending",
            write_error: null,
            written_at: null,
          })
          .eq("id", existingDelivery.id);
        if (reassignErr) throw reassignErr;
        existingDelivery.client_id = clientId;
        existingDelivery.write_status = "pending";
      }

      if (existingDelivery.write_status !== "נכתב") {
        await writeDeliveryToClientSheet(supabase, {
          deliveryId: existingDelivery.id,
          messageId: existingDelivery.message_id,
          userId: existingDelivery.user_id,
          clientId: existingDelivery.client_id,
          delivery_date: existingDelivery.delivery_date,
          description: existingDelivery.description,
          contact_ordered_by: existingDelivery.contact_ordered_by,
          notes: existingDelivery.notes,
          price: existingDelivery.price,
          checkDuplicate: true,
        });
      }
      await supabase
        .from("incoming_messages")
        .update({
          status: "done",
          error_detail: null,
          processed_at: new Date().toISOString(),
        })
        .eq("id", messageId);
      try {
        await supabase
          .from("processing_errors")
          .update({ resolved_at: new Date().toISOString() })
          .eq("message_id", messageId)
          .neq("error_type", "sheet_write_failed")
          .is("resolved_at", null);
      } catch {
        // best-effort
      }
      return { ok: true, status: "done", deliveryId: existingDelivery.id };
    }

    const { data: newDelivery, error: delErr } = await supabase
      .from("deliveries")
      .insert({
        message_id: messageId,
        client_id: clientId,
        user_id: msg.user_id,
        delivery_date: deliveryDate,
        description: parsed.description,
        notes: mergeNotes(parsed.notes),
        price: parsed.price,
        price_missing: parsed.price == null,
        vat_explicit: parsed.vat_explicit,
        contact_ordered_by: parsed.contact_ordered_by,
        write_status: "pending",
      })
      .select("id")
      .single();
    if (delErr) throw delErr;

    const writeRes = await writeDeliveryToClientSheet(supabase, {
      deliveryId: newDelivery.id,
      messageId,
      userId: msg.user_id,
      clientId,
      delivery_date: deliveryDate,
      description: parsed.description,
      contact_ordered_by: parsed.contact_ordered_by,
      notes: mergeNotes(parsed.notes),
      price: parsed.price,
      fast: true,
    });

    await supabase
      .from("incoming_messages")
      .update({
        status: "done",
        error_detail: null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", messageId);
    try {
      await supabase
        .from("processing_errors")
        .update({ resolved_at: new Date().toISOString() })
        .eq("message_id", messageId)
        .neq("error_type", "sheet_write_failed")
        .is("resolved_at", null);
    } catch {
      // best-effort
    }

    if (writeRes.writeStatus === "נכתב" && msg.sender_phone) {
      const { data: c } = await supabase
        .from("clients")
        .select("client_name")
        .eq("id", clientId)
        .maybeSingle();
      await sendConfirmationIfNeeded(supabase, {
        toPhone: msg.sender_phone,
        fromPhone: businessPhone,
        userId: msg.user_id,
        originalMessageId: messageId,
        clientName: c?.client_name ?? "",
        deliveryDate,
        description: parsed.description,
        price: parsed.price,
      });
    }

    return { ok: true, status: "done", deliveryId: newDelivery.id };
  } catch (e: any) {
    const reason = e?.message ?? "שגיאה לא ידועה";
    await supabase
      .from("incoming_messages")
      .update({
        status: "failed",
        error_detail: reason,
        processed_at: new Date().toISOString(),
      })
      .eq("id", messageId);
    await supabase.from("processing_errors").insert({
      message_id: messageId,
      user_id: msg.user_id,
      error_type: "processing_failed",
      error_description: reason,
    });
    return { ok: false, status: "failed", errorMessage: reason };
  }
}
