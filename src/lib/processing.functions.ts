import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const processMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string }) => z.object({ messageId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Auth is enforced by requireSupabaseAuth above (the user must be logged in).
    // But message processing is a server operation that writes to RLS-protected
    // tables (deliveries, pending_clarifications). We run it with the service_role
    // client — exactly like the Twilio webhook does — so the UI "reprocess" path
    // has the same permissions as the real webhook path. We still verify the
    // message belongs to the authenticated user before processing.
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
