import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw error;
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    return { profile: data, roles: (roles ?? []).map((r) => r.role) };
  });

export const updateWhatsappPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { whatsapp_phone: string | null }) =>
    z.object({ whatsapp_phone: z.string().trim().min(3).nullable() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ whatsapp_phone: data.whatsapp_phone })
      .eq("id", context.userId);
    if (error) {
      if (error.code === "23505") throw new Error("מספר זה כבר משויך למשתמש אחר");
      throw error;
    }
    return { ok: true };
  });
