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

export const Route = createFileRoute("/_authenticated/aliases")({
  component: AliasesPage,
});

function AliasesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAliases);
  const clientsFn = useServerFn(listClients);
  const createFn = useServerFn(createAlias);
  const delFn = useServerFn(deleteAlias);

  const aliases = useQuery({ queryKey: ["aliases"], queryFn: () => listFn() });
  const clients = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn() });

  const [clientId, setClientId] = useState("");
  const [alias, setAlias] = useState("");

  const createMut = useMutation({
    mutationFn: (v: { client_id: string; alias: string }) => createFn({ data: v }),
    onSuccess: () => { toast.success("כינוי נוסף"); setAlias(""); qc.invalidateQueries({ queryKey: ["aliases"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("נמחק"); qc.invalidateQueries({ queryKey: ["aliases"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">כינויים</h2>

      <Card className="p-4">
        <div className="grid gap-4 md:grid-cols-3 items-end">
          <div className="space-y-2">
            <Label>לקוח</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="בחר לקוח" /></SelectTrigger>
              <SelectContent>
                {clients.data?.filter((c) => !c.is_archived).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.client_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>כינוי</Label><Input value={alias} onChange={(e) => setAlias(e.target.value)} /></div>
          <Button disabled={!clientId || !alias.trim() || createMut.isPending} onClick={() => createMut.mutate({ client_id: clientId, alias })}>הוסף כינוי</Button>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">כינוי</TableHead>
              <TableHead className="text-right">לקוח</TableHead>
              <TableHead className="text-right">פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {aliases.data?.map((a: any) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.alias}</TableCell>
                <TableCell>{a.clients?.client_name ?? "—"}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => delMut.mutate(a.id)}>מחק</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
