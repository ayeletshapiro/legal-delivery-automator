import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listErrors, resolveError } from "@/lib/errors.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/errors")({
  component: ErrorsPage,
});

function ErrorsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listErrors);
  const resolveFn = useServerFn(resolveError);
  const { data, isLoading } = useQuery({ queryKey: ["errors"], queryFn: () => listFn() });
  const mut = useMutation({
    mutationFn: (id: string) => resolveFn({ data: { id } }),
    onSuccess: () => { toast.success("סומן כטופל"); qc.invalidateQueries({ queryKey: ["errors"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">שגיאות עיבוד</h2>
      <Card>
        {isLoading ? <div className="p-8 text-center text-muted-foreground">טוען...</div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">תאריך</TableHead>
                <TableHead className="text-right">סוג</TableHead>
                <TableHead className="text-right">תיאור</TableHead>
                <TableHead className="text-right">הודעה מקורית</TableHead>
                <TableHead className="text-right">שולח</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((e) => {
                const msg = e.incoming_messages;
                const msgText = msg?.transcribed_text || msg?.raw_text || "";
                return (
                <TableRow key={e.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleString("he-IL")}</TableCell>
                  <TableCell>{e.error_type}</TableCell>
                  <TableCell className="max-w-xs">{e.error_description || "—"}</TableCell>
                  <TableCell className="max-w-sm">
                    {msgText ? (
                      <div className="text-xs line-clamp-2 whitespace-pre-wrap" title={msgText}>{msgText}</div>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap" dir="ltr">{msg?.sender_phone ?? "—"}</TableCell>
                  <TableCell>{e.resolved_at ? <Badge variant="outline">טופל</Badge> : <Badge variant="destructive">פתוח</Badge>}</TableCell>
                  <TableCell>
                    {!e.resolved_at && <Button size="sm" variant="outline" onClick={() => mut.mutate(e.id)}>סמן כטופל</Button>}
                  </TableCell>
                </TableRow>
                );
              })}
              {data?.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">אין שגיאות</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
