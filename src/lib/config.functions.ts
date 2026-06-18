import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("app_config")
      .select("*")
      .is("user_id", null)
      .maybeSingle();
    if (error) throw error;
    return data;
  });

export const updateVatRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { vat_rate: number }) =>
    z.object({ vat_rate: z.number().min(0).max(1) }).parse(d)
  )
  .handler(async ({ data, context }) => {
    // admin only
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("רק אדמין יכול לעדכן מע\"מ");

    const { data: existing } = await context.supabase
      .from("app_config")
      .select("id")
      .is("user_id", null)
      .maybeSingle();

    if (existing) {
      const { error } = await context.supabase
        .from("app_config")
        .update({ vat_rate: data.vat_rate })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await context.supabase
        .from("app_config")
        .insert({ vat_rate: data.vat_rate, user_id: null });
      if (error) throw error;
    }
    return { ok: true };
  });
