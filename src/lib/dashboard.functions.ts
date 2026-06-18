import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const [msgsToday, openErrors, activeClients, totalDeliveries] = await Promise.all([
      context.supabase.from("incoming_messages").select("*", { count: "exact", head: true }).gte("created_at", todayIso),
      context.supabase.from("processing_errors").select("*", { count: "exact", head: true }).is("resolved_at", null),
      context.supabase.from("clients").select("*", { count: "exact", head: true }).eq("is_archived", false),
      context.supabase.from("deliveries").select("*", { count: "exact", head: true }),
    ]);

    return {
      messagesToday: msgsToday.count ?? 0,
      openErrors: openErrors.count ?? 0,
      activeClients: activeClients.count ?? 0,
      totalDeliveries: totalDeliveries.count ?? 0,
    };
  });
