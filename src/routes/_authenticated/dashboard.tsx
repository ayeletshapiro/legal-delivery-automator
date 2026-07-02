import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { getDashboardStats } from "@/lib/dashboard.functions";
import { repairFailedWrites } from "@/lib/deliveries.functions";
import { Card } from "@/components/ui/card";
import { MessageSquare, AlertCircle, Users, Truck, Package } from "lucide-react";


export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

/** Hebrew greeting based on the current hour. */
function greeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "בוקר טוב";
  if (h >= 12 && h < 17) return "צהריים טובים";
  if (h >= 17 && h < 21) return "ערב טוב";
  return "לילה טוב";
}

function Dashboard() {
  const fetcher = useServerFn(getDashboardStats);
  const repair = useServerFn(repairFailedWrites);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fetcher(),
  });

  const ranRef = useRef(false);
  useEffect(() => {
    if (!data) return;
    if (ranRef.current) return;
    ranRef.current = true;
    repair()
      .then((res) => {
        if (res && res.repaired > 0) {
          toast.success(`תוקנו ${res.repaired} שליחויות שלא נכתבו לגיליון`);
          queryClient.invalidateQueries({ queryKey: ["deliveries"] });
          queryClient.invalidateQueries({ queryKey: ["messages"] });
          queryClient.invalidateQueries({ queryKey: ["errors"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
        }
      })
      .catch(() => {
        // Silent: background self-repair must never surface errors to the user.
      });
  }, [data, repair, queryClient]);


  if (!data) return <div className="text-muted-foreground">טוען...</div>;

  const cards = [
    {
      title: 'סה"כ שליחויות',
      value: data.totalDeliveries,
      icon: Package,
      to: "/deliveries",
      iconColor: "text-emerald-700",
      iconBg: "bg-emerald-50",
    },
    {
      title: "הודעות היום",
      value: data.messagesToday,
      icon: MessageSquare,
      to: "/messages",
      iconColor: "text-sky-700",
      iconBg: "bg-sky-50",
    },
    {
      title: "לקוחות פעילים",
      value: data.activeClients,
      icon: Users,
      to: "/clients",
      iconColor: "text-violet-700",
      iconBg: "bg-violet-50",
    },
    {
      title: "שגיאות פתוחות",
      value: data.openErrors,
      icon: AlertCircle,
      to: "/errors",
      iconColor: "text-red-700",
      iconBg: "bg-red-50",
    },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Brand header + greeting */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary">
          <Truck className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <p className="text-lg font-semibold leading-tight">שליחויות אביעד</p>
          <p className="text-sm text-muted-foreground leading-tight">{greeting()} 👋 הנה התמונה להיום</p>
        </div>
      </div>


      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.title} to={c.to} className="group">
            <Card className="cursor-pointer p-4 transition hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40">
              <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${c.iconBg}`}>
                <c.icon className={`h-5 w-5 ${c.iconColor}`} />
              </div>
              <div className="text-3xl font-bold leading-none">{c.value}</div>
              <p className="mt-1.5 text-sm text-muted-foreground">{c.title}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
