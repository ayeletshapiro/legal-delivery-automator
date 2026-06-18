import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardStats } from "@/lib/dashboard.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, AlertCircle, Users, Truck, HelpCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const fetcher = useServerFn(getDashboardStats);
  const { data } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fetcher(),
  });

  if (!data) return <div className="text-muted-foreground">טוען...</div>;

  const cards: Array<{ title: string; value: number; icon: any; to: string }> = [
    { title: "הודעות היום", value: data.messagesToday, icon: MessageSquare, to: "/messages" },
    { title: "שגיאות פתוחות", value: data.openErrors, icon: AlertCircle, to: "/errors" },
    { title: "לקוחות פעילים", value: data.activeClients, icon: Users, to: "/clients" },
    { title: 'סה"כ שליחויות', value: data.totalDeliveries, icon: Truck, to: "/deliveries" },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">דשבורד</h2>

      {data.openClarifications > 0 && (
        <Link
          to="/clarifications"
          className="block rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 hover:bg-amber-100 transition"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <HelpCircle className="h-4 w-4" />
            יש {data.openClarifications} בירורי לקוח פתוחים — לחץ/י לטיפול
          </div>
        </Link>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.title}
            to={c.to}
            className="group"
          >
            <Card className="cursor-pointer transition hover:shadow-md hover:border-primary/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
                <c.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{c.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
