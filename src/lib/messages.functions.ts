import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: string | null }) =>
    z.object({ status: z.string().nullable().optional() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("incoming_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status) q = q.eq("status", data.status as any);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows;
  });

export const createTestMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    sender_phone: string;
    message_type: "text" | "audio" | "image" | "document";
    raw_text?: string;
  }) =>
    z.object({
      sender_phone: z.string().trim().min(3),
      message_type: z.enum(["text", "audio", "image", "document"]),
      raw_text: z.string().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const wid = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { data: row, error } = await context.supabase
      .from("incoming_messages")
      .insert({
        whatsapp_message_id: wid,
        sender_phone: data.sender_phone,
        message_type: data.message_type,
        raw_text: data.raw_text ?? null,
        media_received: data.message_type !== "text",
        status: "received",
        user_id: context.userId,
      })
      .select()
      .single();
    if (error) throw error;
    return row;
  });
