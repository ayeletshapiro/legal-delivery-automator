import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_deliveries",
  title: "List deliveries",
  description: "List recent deliveries for the signed-in user, optionally filtered by date range, client, or write status.",
  inputSchema: {
    from: z.string().optional().describe("Start date (YYYY-MM-DD), inclusive."),
    to: z.string().optional().describe("End date (YYYY-MM-DD), inclusive."),
    client_id: z.string().uuid().optional().describe("Filter by client UUID."),
    write_status: z.string().optional().describe("Filter by write_status (e.g. 'נכתב', 'שגיאה', 'ללא גיליון')."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows to return (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, client_id, write_status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    let q = supabaseForUser(ctx)
      .from("deliveries")
      .select("id, delivery_date, description, price, price_missing, notes, contact_ordered_by, write_status, write_error, clients(client_name)")
      .order("delivery_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (from) q = q.gte("delivery_date", from);
    if (to) q = q.lte("delivery_date", to);
    if (client_id) q = q.eq("client_id", client_id);
    if (write_status) q = q.eq("write_status", write_status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { deliveries: data ?? [] },
    };
  },
});
