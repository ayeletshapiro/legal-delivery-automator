import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listClientsTool from "./tools/list-clients";
import listDeliveriesTool from "./tools/list-deliveries";
import listMessagesTool from "./tools/list-messages";
import dashboardStatsTool from "./tools/dashboard-stats";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "legal-delivery-automator-mcp",
  title: "ניהול שליחויות – אביעד",
  version: "0.1.0",
  instructions:
    "Tools for the Legal Delivery Automator app. Use `list_clients` to find client IDs, `list_deliveries` to view deliveries (optionally filtered by date/client/status), `list_recent_messages` for incoming WhatsApp activity, and `get_dashboard_stats` for a quick overview.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listClientsTool, listDeliveriesTool, listMessagesTool, dashboardStatsTool],
});
