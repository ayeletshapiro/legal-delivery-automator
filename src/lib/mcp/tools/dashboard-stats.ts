import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_dashboard_stats",
  title: "Dashboard stats",
  description: "Return counts of deliveries by write status and total counts of clients, messages, and open errors for the signed-in user.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const [clients, deliveries, messages, errors] = await Promise.all([
      sb.from("clients").select("id", { count: "exact", head: true }).eq("is_archived", false),
      sb.from("deliveries").select("write_status"),
      sb.from("incoming_messages").select("id", { count: "exact", head: true }),
      sb.from("processing_errors").select("id", { count: "exact", head: true }).is("resolved_at", null),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of deliveries.data ?? []) {
      const s = (row as { write_status?: string | null }).write_status ?? "unknown";
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }

    const stats = {
      clients_active: clients.count ?? 0,
      deliveries_total: deliveries.data?.length ?? 0,
      deliveries_by_status: byStatus,
      messages_total: messages.count ?? 0,
      open_errors: errors.count ?? 0,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(stats) }],
      structuredContent: stats,
    };
  },
});
