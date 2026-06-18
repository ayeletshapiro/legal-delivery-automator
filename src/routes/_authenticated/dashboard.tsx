import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardStats } from "@/lib/dashboard.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, AlertCircle, Users, Truck } from "lucide-react";

const statsQuery = queryOptions({
  queryKey: ["dashboard-stats"],
  queryFn: () => getDashboardStats(),
});

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const fetcher = useServerFn(getDashboardStats);
  const { data } = useSuspenseQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fetcher(),
  });

  const cards = [
    { title: "הודעות היום", value: data.messagesToday, icon: MessageSquare },
    { title: "שגיאות פתוחות", value: data.openErrors, icon: AlertCircle },
    { title: "לקוחות פעילים", value: data.activeClients, icon: Users },
    { title: 'סה"כ משימות', value: data.totalDeliveries, icon: Truck },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">דשבורד</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export { statsQuery };
