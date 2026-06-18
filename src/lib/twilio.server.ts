/**
 * Twilio WhatsApp outbound sender. Server-only.
 * Sends a WhatsApp message and logs every attempt into outbound_messages.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

export interface SendOptions {
  fromPhone?: string | null;          // Twilio "From" (the business number). Defaults to TWILIO_WHATSAPP_FROM.
  supabase?: DB | null;               // when provided, the attempt is logged to outbound_messages.
  userId?: string | null;
  incomingMessageId?: string | null;
  replyType?: string | null;          // e.g. "clarification_prompt" | "clarification_reprompt" | "confirmation" | "cancelled"
}

export interface SendResult {
  ok: boolean;
  error?: string;
  sid?: string;
}

export async function sendWhatsAppMessage(
  toPhoneE164: string,
  body: string,
  opts: SendOptions = {},
): Promise<SendResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromConfigured = (opts.fromPhone && opts.fromPhone.trim()) || process.env.TWILIO_WHATSAPP_FROM;

  const toBare = toPhoneE164.replace(/^whatsapp:/i, "").trim();
  const fromBare = (fromConfigured ?? "").replace(/^whatsapp:/i, "").trim();

  const log = async (status: string, sid: string | null, error: string | null) => {
    if (!opts.supabase) return;
    try {
      await opts.supabase.from("outbound_messages").insert({
        user_id: opts.userId ?? null,
        incoming_message_id: opts.incomingMessageId ?? null,
        to_phone: toBare,
        from_phone: fromBare || null,
        body,
        reply_type: opts.replyType ?? null,
        status,
        twilio_message_sid: sid,
        error_message: error,
      });
    } catch (e) {
      console.error("[twilio] outbound log failed", e);
    }
  };

  if (!accountSid || !authToken || !fromBare) {
    const err = "Twilio לא מוגדר במלואו (חסר TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM)";
    await log("failed", null, err);
    return { ok: false, error: err };
  }

  const to = `whatsapp:${toBare}`;
  const from = `whatsapp:${fromBare}`;

  const basic = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    const json = await resp.json().catch(() => ({} as Record<string, unknown>));
    if (!resp.ok) {
      const msg = (json as { message?: string }).message ?? `Twilio ${resp.status}`;
      await log("failed", null, msg);
      return { ok: false, error: msg };
    }
    const sid = (json as { sid?: string }).sid ?? null;
    await log("sent", sid, null);
    return { ok: true, sid: sid ?? undefined };
  } catch (e) {
    const err = e instanceof Error ? e.message : "שליחת WhatsApp נכשלה";
    await log("failed", null, err);
    return { ok: false, error: err };
  }
}
