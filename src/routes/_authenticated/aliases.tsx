import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listAliases, createAlias, deleteAlias } from "@/lib/aliases.functions";
import { listClients } from "@/lib/clients.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Tags, Plus, Trash2, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/aliases")({
  component: AliasesPage,
});

/** Initials for the avatar (first letters of up to two words). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[1][0];
}

/** Deterministic soft color per client name, for a friendly avatar. */
const AVATAR_COLORS = [
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

function Avatar({ name, size = 8 }: { name: string; size?: number }) {
  const dim = size === 8 ? "h-8 w-8 text-xs" : "h-9 w-9 text-sm";
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full font-medium ${dim} ${avatarColor(name)}`}>
      {initials(name)}
    </div>
  );
}

type Alias = {
  id: string;
  alias: string;
  clients: { client_name: string } | null;
};

function AliasesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAliases);
  const clientsFn = useServerFn(listClients);
  const createFn = useServerFn(createAlias);
  const delFn = useServerFn(deleteAlias);

  const aliases = useQuery({ queryKey: ["aliases"], queryFn: () => listFn() as Promise<Alias[]> });
  const clients = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn() });

  const [clientId, setClientId] = useState("");
  const [alias, setAlias] = useState("");

  const createMut = useMutation({
    mutationFn: (v: { client_id: string; alias: string }) => createFn({ data: v }),
    onSuccess: () => {
      toast.success("כינוי נוסף");
      setAlias("");
      qc.invalidateQueries({ queryKey: ["aliases"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("נמחק");
      qc.invalidateQueries({ queryKey: ["aliases"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = aliases.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary">
          <Tags className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <h2 className="text-xl font-semibold leading-tight">כינויים</h2>
          <p className="text-sm text-muted-foreground leading-tight">שמות חלופיים שמזהים לקוח בהודעות נכנסות</p>
        </div>
      </div>

      {/* Add form */}
      <Card className="p-4">
        <div className="grid items-end gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>לקוח</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue placeholder="בחר לקוח" />
              </SelectTrigger>
              <SelectContent>
                {clients.data
                  ?.filter((c) => !c.is_archived)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.client_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>כינוי</Label>
            <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="למשל: עו״ד כהן" />
          </div>
          <Button
            disabled={!clientId || !alias.trim() || createMut.isPending}
            onClick={() => createMut.mutate({ client_id: clientId, alias })}
          >
            <Plus className="ml-1.5 h-4 w-4" />
            הוסף כינוי
          </Button>
        </div>
      </Card>

      {/* List */}
      {aliases.isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">טוען...</Card>
      ) : rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <Tags className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">עדיין אין כינויים — הוסף את הראשון למעלה</p>
        </Card>
      ) : (
        <>
          {/* DESKTOP: table */}
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">כינוי</TableHead>
                  <TableHead className="text-right">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => {
                  const clientName = a.clients?.client_name ?? "—";
                  return (
                    <TableRow key={a.id} className="hover:bg-muted/30">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={clientName} />
                          <span className="font-medium">{clientName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                          <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm font-medium">
                            <Tags className="h-3.5 w-3.5 text-muted-foreground" />
                            {a.alias}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => delMut.mutate(a.id)}
                        >
                          <Trash2 className="ml-1.5 h-4 w-4" />
                          מחק
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          {/* MOBILE: cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((a) => {
              const clientName = a.clients?.client_name ?? "—";
              return (
                <Card key={a.id} className="p-4">
                  <div className="mb-3 flex items-center gap-2.5">
                    <Avatar name={clientName} size={9} />
                    <div className="min-w-0 flex-1">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium">
                        <Tags className="h-3.5 w-3.5 text-muted-foreground" />
                        {a.alias}
                      </span>
                      <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <ArrowLeft className="h-3.5 w-3.5" />
                        {clientName}
                      </p>
                    </div>
                  </div>
                  <div className="border-t pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-destructive hover:text-destructive"
                      onClick={() => delMut.mutate(a.id)}
                    >
                      <Trash2 className="ml-1.5 h-4 w-4" />
                      מחק כינוי
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
