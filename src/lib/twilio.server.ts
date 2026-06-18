/**
 * Twilio WhatsApp outbound sender. Server-only.
 * Sends a WhatsApp message to a given E.164 phone number using
 * the Twilio REST API directly (Account SID + Auth Token).
 */

interface SendResult {
  ok: boolean;
  error?: string;
  sid?: string;
}

export async function sendWhatsAppMessage(toPhoneE164: string, body: string): Promise<SendResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromWhats = process.env.TWILIO_WHATSAPP_FROM; // e.g. "+14155238886" (Twilio sandbox) or business number

  if (!accountSid || !authToken || !fromWhats) {
    return { ok: false, error: "Twilio לא מוגדר במלואו (חסר TWILIO_ACCOUNT_SID / TWILIO_WHATSAPP_FROM / TWILIO_AUTH_TOKEN)" };
  }

  const to = toPhoneE164.startsWith("whatsapp:") ? toPhoneE164 : `whatsapp:${toPhoneE164}`;
  const from = fromWhats.startsWith("whatsapp:") ? fromWhats : `whatsapp:${fromWhats}`;

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
      return { ok: false, error: msg };
    }
    return { ok: true, sid: (json as { sid?: string }).sid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "שליחת WhatsApp נכשלה" };
  }
}
