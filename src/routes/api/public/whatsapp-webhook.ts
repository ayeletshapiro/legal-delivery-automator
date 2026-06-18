import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/api/public/whatsapp-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.MAKE_WEBHOOK_SECRET;
        // If no secret configured — endpoint is closed.
        if (!secret) {
          return new Response(
            JSON.stringify({ error: "Webhook not configured" }),
            { status: 503, headers: { "content-type": "application/json" } }
          );
        }

        const provided = request.headers.get("x-make-secret") ?? "";
        // Timing-safe compare
        const a = new TextEncoder().encode(secret);
        const b = new TextEncoder().encode(provided);
        let ok = a.length === b.length;
        const len = Math.max(a.length, b.length);
        let diff = a.length ^ b.length;
        for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
        ok = ok && diff === 0;
        if (!ok) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401, headers: { "content-type": "application/json" },
          });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
        }

        const schema = z.object({
          whatsapp_message_id: z.string().min(1),
          sender_phone: z.string().min(3),
          message_type: z.enum(["text", "audio", "image", "document"]),
          raw_text: z.string().nullable().optional(),
          media_received: z.boolean().optional(),
        });
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ error: "Validation failed", details: parsed.error.flatten() }),
            { status: 400, headers: { "content-type": "application/json" } }
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Try to map sender_phone to a user via profiles.whatsapp_phone
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("whatsapp_phone", parsed.data.sender_phone)
          .maybeSingle();

        const { error } = await supabaseAdmin.from("incoming_messages").insert({
          whatsapp_message_id: parsed.data.whatsapp_message_id,
          sender_phone: parsed.data.sender_phone,
          message_type: parsed.data.message_type,
          raw_text: parsed.data.raw_text ?? null,
          media_received: parsed.data.media_received ?? parsed.data.message_type !== "text",
          status: "received",
          user_id: profile?.id ?? null,
        });

        if (error) {
          // duplicate key → already received, treat as success (idempotent)
          if (error.code === "23505") {
            return new Response(JSON.stringify({ ok: true, duplicate: true }), {
              status: 200, headers: { "content-type": "application/json" },
            });
          }
          console.error("[webhook] insert error", error);
          return new Response(JSON.stringify({ error: "DB error" }), { status: 500 });
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
