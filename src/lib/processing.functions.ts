import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const processMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string }) => z.object({ messageId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Auth is enforced by requireSupabaseAuth above. Processing writes to
    // RLS-protected tables (deliveries, etc.) via the service_role client,
    // matching the Twilio webhook path. We verify ownership first.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: msg, error } = await supabaseAdmin
      .from("incoming_messages")
      .select("user_id")
      .eq("id", data.messageId)
      .maybeSingle();
    if (error) throw error;
    if (!msg || msg.user_id !== context.userId) {
      throw new Error("אין הרשאה לעבד הודעה זו");
    }

    const { processIncomingMessage } = await import("./processing.server");
    return processIncomingMessage(supabaseAdmin, data.messageId);
  });
