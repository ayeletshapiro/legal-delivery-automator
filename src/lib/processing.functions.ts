import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const processMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string }) =>
    z.object({ messageId: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { processIncomingMessage } = await import("./processing.server");
    return processIncomingMessage(context.supabase, data.messageId);
  });
